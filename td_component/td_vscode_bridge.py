"""
TouchDesigner VS Code Bridge - Server Implementation
Runs inside TouchDesigner as the callbacks script for a WebServer DAT.
Handles remote code execution, OP tree inspection, autocomplete metadata, and DAT sync.
"""

import sys
import io
import json
import traceback
import time

def onServerStart(webServerDAT):
    print("[TD_VSCODE_BRIDGE] Server started on port:", webServerDAT.par.port.eval())

def onServerStop(webServerDAT):
    print("[TD_VSCODE_BRIDGE] Server stopped.")

def onWebSocketOpen(webServerDAT, client):
    print(f"[TD_VSCODE_BRIDGE] Client connected: {client}")

def onWebSocketClose(webServerDAT, client):
    print(f"[TD_VSCODE_BRIDGE] Client disconnected: {client}")

def onWebSocketReceiveText(webServerDAT, client, data):
    try:
        req = json.loads(data)
        req_id = req.get('id', '')
        action = req.get('action', '')

        response = {
            'id': req_id,
            'action': action,
            'success': True
        }

        if action == 'ping':
            handle_ping(response)
        elif action == 'eval':
            handle_eval(req, response)
        elif action == 'get_op_tree':
            handle_get_op_tree(req, response)
        elif action == 'get_op_completions':
            handle_get_op_completions(req, response)
        elif action == 'get_op_params':
            handle_get_op_params(req, response)
        elif action == 'get_op_details':
            handle_get_op_details(req, response)
        elif action == 'sync_dat':
            handle_sync_dat(req, response)
        elif action == 'fetch_dat':
            handle_fetch_dat(req, response)
        elif action == 'cook_op':
            handle_cook_op(req, response)
        elif action == 'set_op_param':
            handle_set_op_param(req, response)
        elif action == 'pulse_op_param':
            handle_pulse_op_param(req, response)
        elif action == 'batch_fetch_dats':
            handle_batch_fetch_dats(req, response)
        elif action == 'apply_param_snapshot':
            handle_apply_param_snapshot(req, response)
        else:
            response['success'] = False
            response['error'] = f"Unknown action '{action}'"

        webServerDAT.webSocketSendText(client, json.dumps(response))

    except Exception as e:
        err_response = {
            'id': req.get('id', '') if 'req' in locals() and isinstance(req, dict) else '',
            'action': req.get('action', 'error') if 'req' in locals() and isinstance(req, dict) else 'error',
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }
        try:
            webServerDAT.webSocketSendText(client, json.dumps(err_response))
        except Exception:
            pass


def handle_ping(response):
    response.update({
        'version': '0.5.0',
        'tdVersion': app.version,
        'tdBuild': app.build,
        'os': app.osName,
        'projectName': project.name,
        'projectPath': project.folder
    })


def handle_eval(req, response):
    code = req.get('code', '')
    context_op_path = req.get('contextOp')

    target_op = op(context_op_path) if context_op_path else op('/')
    
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    old_stdout = sys.stdout
    old_stderr = sys.stderr

    start_time = time.time()
    exec_result = None
    result_type = 'None'

    try:
        sys.stdout = stdout_buf
        sys.stderr = stderr_buf

        # Build execution environment mimicking TouchDesigner script DAT
        exec_globals = {
            'op': op,
            'me': target_op,
            'parent': target_op.parent if target_op and hasattr(target_op, 'parent') else None,
            'tdu': tdu,
            'app': app,
            'ui': ui,
            'project': project,
            'absTime': absTime,
            'runs': runs,
            'mod': mod,
        }

        # Try eval first for expressions (e.g. 2 + 2, op('geo1').par.tx)
        try:
            code_compiled = compile(code, '<vscode>', 'eval')
            exec_result = eval(code_compiled, exec_globals)
            result_type = type(exec_result).__name__
        except SyntaxError:
            # Multi-statement code or assignment (exec)
            code_compiled = compile(code, '<vscode>', 'exec')
            exec(code_compiled, exec_globals)
            exec_result = None
            result_type = 'None'

    except Exception as e:
        response['success'] = False
        response['error'] = str(e)
        response['traceback'] = traceback.format_exc()
        stderr_buf.write(traceback.format_exc())
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    elapsed_ms = (time.time() - start_time) * 1000

    # Safely serialize result
    safe_result = None
    if exec_result is not None:
        try:
            # Test if JSON serializable
            json.dumps(exec_result)
            safe_result = exec_result
        except (TypeError, OverflowError):
            safe_result = repr(exec_result)

    response['result'] = safe_result
    response['resultType'] = result_type
    response['stdout'] = stdout_buf.getvalue()
    response['stderr'] = stderr_buf.getvalue()
    response['executionTimeMs'] = elapsed_ms


def handle_get_op_tree(req, response):
    root_path = req.get('rootPath', '/')
    depth = req.get('depth', 1)
    include_dats_only = req.get('includeDatsOnly', False)

    root_op = op(root_path)
    if not root_op:
        response['tree'] = []
        return

    def serialize_node(target, current_depth):
        is_comp = target.isCOMP
        children_nodes = []

        if is_comp and current_depth < depth:
            for child in target.children:
                if include_dats_only and not child.isDAT and not child.isCOMP:
                    continue
                children_nodes.append(serialize_node(child, current_depth + 1))

        return {
            'name': target.name,
            'path': target.path,
            'family': target.family,
            'type': target.type,
            'hasChildren': is_comp and len(target.children) > 0,
            'children': children_nodes if is_comp and current_depth < depth else [],
            'isDat': target.isDAT,
            'isScript': target.isDAT and target.type in ('text', 'script'),
            'error': target.errors() or None,
            'warning': target.warnings() or None,
            'numChildren': len(target.children) if is_comp else 0
        }

    tree = []
    if root_op.isCOMP:
        for child in root_op.children:
            if include_dats_only and not child.isDAT and not child.isCOMP:
                continue
            tree.append(serialize_node(child, 1))
    else:
        tree.append(serialize_node(root_op, 1))

    response['tree'] = tree


def handle_get_op_completions(req, response):
    prefix = req.get('prefix', '')
    items = []

    # Search project for matching operator paths
    try:
        all_ops = root.findChildren() if hasattr(root, 'findChildren') else []
        for o in all_ops:
            if not prefix or o.path.startswith(prefix) or prefix in o.path:
                items.append({
                    'label': o.name,
                    'path': o.path,
                    'family': o.family,
                    'type': o.type,
                    'isDat': o.isDAT
                })
    except Exception:
        # Fallback to traversing children of project1
        p1 = op('/project1')
        if p1:
            for o in p1.children:
                items.append({
                    'label': o.name,
                    'path': o.path,
                    'family': o.family,
                    'type': o.type,
                    'isDat': o.isDAT
                })

    response['items'] = items


def handle_get_op_params(req, response):
    target_path = req.get('path', '')
    target = op(target_path)
    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return

    params_list = []
    for p in target.pars():
        menu_names = []
        menu_labels = []
        if hasattr(p, 'menuNames') and p.menuNames:
            menu_names = list(p.menuNames)
            menu_labels = list(p.menuLabels) if hasattr(p, 'menuLabels') and p.menuLabels else []

        val = None
        try:
            val = p.eval()
            if not isinstance(val, (int, float, str, bool)):
                val = str(val)
        except Exception:
            val = str(p.val)

        norm_min = getattr(p, 'normMin', None)
        norm_max = getattr(p, 'normMax', None)
        abs_min = getattr(p, 'min', None)
        abs_max = getattr(p, 'max', None)

        param_dict = {
            'name': p.name,
            'label': p.label,
            'page': p.page.name if hasattr(p, 'page') and p.page else 'Default',
            'type': getattr(p, 'style', type(p).__name__),
            'val': val,
            'isCustom': getattr(p, 'isCustom', False),
            'readOnly': getattr(p, 'readOnly', False),
            'menuNames': menu_names,
            'menuLabels': menu_labels
        }
        if norm_min is not None and isinstance(norm_min, (int, float)):
            param_dict['normMin'] = norm_min
        if norm_max is not None and isinstance(norm_max, (int, float)):
            param_dict['normMax'] = norm_max
        if abs_min is not None and isinstance(abs_min, (int, float)):
            param_dict['min'] = abs_min
        if abs_max is not None and isinstance(abs_max, (int, float)):
            param_dict['max'] = abs_max

        params_list.append(param_dict)

    custom_methods = []
    custom_members = []
    if target.isCOMP and hasattr(target, 'extensions'):
        for ext in target.extensions:
            if ext:
                for attr_name in dir(ext):
                    if not attr_name.startswith('_'):
                        attr_val = getattr(ext, attr_name)
                        if callable(attr_val):
                            custom_methods.append(attr_name)
                        else:
                            custom_members.append(attr_name)

    response['path'] = target.path
    response['params'] = params_list
    response['customMethods'] = custom_methods
    response['customMembers'] = custom_members


def handle_get_op_details(req, response):
    target_path = req.get('path', '')
    target = op(target_path)
    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return

    # Extract basic params preview
    params_list = []
    for p in target.pars():
        params_list.append({
            'name': p.name,
            'label': p.label,
            'page': p.page.name if hasattr(p, 'page') and p.page else 'Default',
            'type': getattr(p, 'style', type(p).__name__),
            'val': str(p.eval()) if hasattr(p, 'eval') else str(p.val),
            'isCustom': getattr(p, 'isCustom', False),
            'readOnly': getattr(p, 'readOnly', False),
        })

    custom_methods = []
    custom_members = []
    if target.isCOMP and hasattr(target, 'extensions'):
        for ext in target.extensions:
            if ext:
                for attr_name in dir(ext):
                    if not attr_name.startswith('_'):
                        if callable(getattr(ext, attr_name)):
                            custom_methods.append(attr_name)
                        else:
                            custom_members.append(attr_name)

    dat_text = target.text if target.isDAT and hasattr(target, 'text') else None

    response['details'] = {
        'path': target.path,
        'name': target.name,
        'family': target.family,
        'type': target.type,
        'cooked': getattr(target, 'cooked', True),
        'cookTime': getattr(target, 'cookTime', 0.0),
        'cpuCookTime': getattr(target, 'cpuCookTime', 0.0),
        'gpuCookTime': getattr(target, 'gpuCookTime', 0.0),
        'params': params_list,
        'customMethods': custom_methods,
        'customMembers': custom_members,
        'error': target.errors() or None,
        'warning': target.warnings() or None,
        'isDat': target.isDAT,
        'datText': dat_text
    }


def handle_sync_dat(req, response):
    target_path = req.get('path', '')
    content = req.get('content', '')
    target = op(target_path)

    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return

    if not target.isDAT or not hasattr(target, 'text'):
        response['success'] = False
        response['error'] = f"Operator is not a text-based DAT: '{target_path}'"
        return

    target.text = content
    response['path'] = target.path

    # Auto-pulse reload on dependent GLSL operators and collect compile diagnostics
    reloaded_ops = []
    compile_errors = []

    dependents = list(target.dependents) if hasattr(target, 'dependents') else []
    if target.parent and getattr(target.parent, 'type', '') in ('glsl', 'glslmulti', 'glslmat', 'glslcompute'):
        if target.parent not in dependents:
            dependents.append(target.parent)

    for dep in dependents:
        # Check for loadpulse or loadfiles parameters
        if hasattr(dep, 'par'):
            if hasattr(dep.par, 'loadpulse'):
                try:
                    dep.par.loadpulse.pulse()
                    reloaded_ops.append(dep.path)
                except Exception:
                    pass
            elif hasattr(dep.par, 'loadfiles'):
                try:
                    dep.par.loadfiles.pulse()
                    reloaded_ops.append(dep.path)
                except Exception:
                    pass
        if hasattr(dep, 'cook'):
            try:
                dep.cook(force=True)
            except Exception:
                pass

        # Check errors / warnings
        if hasattr(dep, 'errors') and dep.errors():
            compile_errors.append({
                'path': dep.path,
                'opType': getattr(dep, 'type', ''),
                'error': dep.errors()
            })
        if hasattr(dep, 'warnings') and dep.warnings():
            compile_errors.append({
                'path': dep.path,
                'opType': getattr(dep, 'type', ''),
                'warning': dep.warnings()
            })

    if hasattr(target, 'errors') and target.errors():
        compile_errors.append({
            'path': target.path,
            'opType': getattr(target, 'type', ''),
            'error': target.errors()
        })

    response['reloadedOps'] = reloaded_ops
    response['compileErrors'] = compile_errors


def handle_fetch_dat(req, response):
    target_path = req.get('path', '')
    target = op(target_path)

    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return

    if not target.isDAT:
        response['success'] = False
        response['error'] = f"Operator is not a DAT: '{target_path}'"
        return

    response['path'] = target.path
    response['content'] = target.text if hasattr(target, 'text') else ''
    response['isTable'] = getattr(target, 'isTable', False)


def handle_cook_op(req, response):
    target_path = req.get('path', '')
    target = op(target_path)

    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return

    target.cook(force=True)
    response['path'] = target.path


def handle_set_op_param(req, response):
    target_path = req.get('path', '')
    param_name = req.get('param', '')
    val = req.get('val')
    target = op(target_path)
    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return
    if not hasattr(target, 'par') or not hasattr(target.par, param_name):
        response['success'] = False
        response['error'] = f"Parameter '{param_name}' not found on '{target_path}'"
        return
    p = getattr(target.par, param_name)
    try:
        p.val = val
        response['path'] = target.path
        response['param'] = param_name
        response['val'] = p.eval() if hasattr(p, 'eval') else p.val
    except Exception as e:
        response['success'] = False
        response['error'] = str(e)


def handle_pulse_op_param(req, response):
    target_path = req.get('path', '')
    param_name = req.get('param', '')
    target = op(target_path)
    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return
    if not hasattr(target, 'par') or not hasattr(target.par, param_name):
        response['success'] = False
        response['error'] = f"Parameter '{param_name}' not found on '{target_path}'"
        return
    p = getattr(target.par, param_name)
    if hasattr(p, 'pulse'):
        try:
            p.pulse()
            response['path'] = target.path
            response['param'] = param_name
        except Exception as e:
            response['success'] = False
            response['error'] = str(e)
    else:
        response['success'] = False
        response['error'] = f"Parameter '{param_name}' is not pulseable"


def handle_batch_fetch_dats(req, response):
    root_path = req.get('rootPath', '/')
    root_op = op(root_path)
    if not root_op:
        response['success'] = False
        response['error'] = f"Root operator not found: '{root_path}'"
        return

    items = []
    candidates = []
    try:
        if hasattr(root_op, 'findChildren'):
            td_dat_cls = globals().get('DAT')
            if td_dat_cls:
                candidates = root_op.findChildren(type=td_dat_cls)
            else:
                candidates = [c for c in root_op.findChildren() if getattr(c, 'isDAT', False)]
        else:
            def collect(current):
                for c in getattr(current, 'children', []):
                    if getattr(c, 'isDAT', False):
                        candidates.append(c)
                    if getattr(c, 'isCOMP', False):
                        collect(c)
            collect(root_op)
    except Exception:
        def collect(current):
            for c in getattr(current, 'children', []):
                if getattr(c, 'isDAT', False):
                    candidates.append(c)
                if getattr(c, 'isCOMP', False):
                    collect(c)
        collect(root_op)

    if getattr(root_op, 'isDAT', False) and root_op not in candidates:
        candidates.append(root_op)

    for d in candidates:
        if getattr(d, 'isDAT', False) and hasattr(d, 'text'):
            items.append({
                'path': d.path,
                'name': d.name,
                'type': getattr(d, 'type', 'text'),
                'content': d.text,
                'isTable': getattr(d, 'isTable', False)
            })

    response['rootPath'] = root_op.path
    response['items'] = items


def handle_apply_param_snapshot(req, response):
    target_path = req.get('path', '')
    snapshot = req.get('snapshot', {})
    target = op(target_path)
    if not target:
        response['success'] = False
        response['error'] = f"Operator not found: '{target_path}'"
        return

    applied_count = 0
    errors = []
    for param_name, val in snapshot.items():
        if hasattr(target, 'par') and hasattr(target.par, param_name):
            p = getattr(target.par, param_name)
            if not getattr(p, 'readOnly', False):
                try:
                    p.val = val
                    applied_count += 1
                except Exception as e:
                    errors.append(f"{param_name}: {str(e)}")

    response['path'] = target.path
    response['appliedCount'] = applied_count
    if errors:
        response['errors'] = errors


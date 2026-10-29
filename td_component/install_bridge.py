"""
TouchDesigner VS Code Bridge - One-Click Installer
Run this script inside TouchDesigner (via Textport or a Text DAT) to create and start the bridge component.
"""

import os
import sys

# Embedded bridge callbacks code to guarantee 100% self-contained installation
EMBEDDED_BRIDGE_CODE = r'''"""
TouchDesigner VS Code Bridge - Server Implementation
Runs inside TouchDesigner as the callbacks script for a WebServer DAT.
Handles remote code execution, OP tree inspection, autocomplete metadata, and DAT sync.
"""

import sys
import io
import json
import traceback
import time

def onServerStart(webserverDAT):
    print("[TD_VSCODE_BRIDGE] Server started on port:", webserverDAT.par.port.eval())

def onServerStop(webserverDAT):
    print("[TD_VSCODE_BRIDGE] Server stopped.")

def onWebSocketOpen(webserverDAT, client):
    print(f"[TD_VSCODE_BRIDGE] Client connected: {client}")

def onWebSocketClose(webserverDAT, client):
    print(f"[TD_VSCODE_BRIDGE] Client disconnected: {client}")

def onWebSocketReceiveText(webserverDAT, client, data):
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

        webserverDAT.webSocketSendText(client, json.dumps(response))

    except Exception as e:
        err_response = {
            'id': req.get('id', '') if 'req' in locals() and isinstance(req, dict) else '',
            'action': req.get('action', 'error') if 'req' in locals() and isinstance(req, dict) else 'error',
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }
        try:
            webserverDAT.webSocketSendText(client, json.dumps(err_response))
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
'''


def install(parent_op=None, port=9988):
    """
    Installs the TD VS Code Bridge component into TouchDesigner.
    """
    try:
        # Determine target parent COMP
        if parent_op is None:
            if 'ui' in globals() and hasattr(ui, 'panes') and ui.panes.current:
                parent_op = ui.panes.current.owner
            if not parent_op and 'op' in globals():
                op_fn = globals()['op']
                parent_op = op_fn('/project1') or op_fn('/')

        if not parent_op:
            print("[TD_VSCODE_BRIDGE] Not running inside TouchDesigner or no parent OP found.")
            return None

        print(f"[TD_VSCODE_BRIDGE] Installing into {parent_op.path}...")

        # Resolve operator types safely across TD versions
        td_mod = sys.modules.get('td', None)

        # 1. Base COMP class
        base_comp_type = globals().get('baseCOMP') or getattr(td_mod, 'baseCOMP', None)
        if not base_comp_type:
            try:
                from tdi.ops.comps import baseCOMP as base_comp_type
            except Exception:
                pass

        # 2. Text DAT class
        text_dat_type = globals().get('textDAT') or getattr(td_mod, 'textDAT', None)
        if not text_dat_type:
            try:
                from tdi.ops.dats import textDAT as text_dat_type
            except Exception:
                pass

        # 3. Webserver DAT class (note lowercase 'server' in TouchDesigner: webserverDAT)
        webserver_dat_type = (
            globals().get('webserverDAT') or 
            globals().get('webServerDAT') or 
            getattr(td_mod, 'webserverDAT', None) or 
            getattr(td_mod, 'webServerDAT', None)
        )
        if not webserver_dat_type:
            try:
                from tdi.ops.dats import webserverDAT as webserver_dat_type
            except Exception:
                pass

        # Fallback to string types if classes aren't in scope
        if not base_comp_type:
            base_comp_type = 'base'
        if not text_dat_type:
            text_dat_type = 'text'
        if not webserver_dat_type:
            webserver_dat_type = 'webserver'

        # Create or reuse COMP container
        comp_name = 'td_vscode_bridge'
        bridge_comp = parent_op.op(comp_name)
        if not bridge_comp:
            bridge_comp = parent_op.create(base_comp_type, comp_name)
            bridge_comp.nodeX = 200
            bridge_comp.nodeY = -200
            bridge_comp.color = (0.2, 0.6, 0.9)

        # Retrieve bridge code: check disk or use embedded fallback
        bridge_code = EMBEDDED_BRIDGE_CODE
        candidate_paths = []
        if '__file__' in globals():
            candidate_paths.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'td_vscode_bridge.py'))
        if 'project' in globals() and hasattr(project, 'folder'):
            candidate_paths.append(os.path.join(project.folder, 'td_vscode_bridge.py'))
            candidate_paths.append(os.path.join(project.folder, 'td_component', 'td_vscode_bridge.py'))

        for p in candidate_paths:
            if os.path.exists(p):
                try:
                    with open(p, 'r', encoding='utf-8') as f:
                        bridge_code = f.read()
                    break
                except Exception:
                    pass

        # Create or update callbacks Text DAT
        callbacks_dat = bridge_comp.op('callbacks')
        if not callbacks_dat:
            callbacks_dat = bridge_comp.create(text_dat_type, 'callbacks')
            callbacks_dat.nodeX = 250
            callbacks_dat.nodeY = 0

        callbacks_dat.text = bridge_code

        # Create or update WebServer DAT
        webserver_dat = bridge_comp.op('webserver1')
        if not webserver_dat:
            webserver_dat = bridge_comp.create(webserver_dat_type, 'webserver1')
            webserver_dat.nodeX = 0
            webserver_dat.nodeY = 0

        # Configure WebServer DAT parameters
        webserver_dat.par.port = port
        webserver_dat.par.callbacks = callbacks_dat.name
        webserver_dat.par.active = 1
        if hasattr(webserver_dat.par, 'restart'):
            webserver_dat.par.restart.pulse()

        # Save a ready-to-use .tox file in the project folder if possible
        try:
            if 'project' in globals() and hasattr(project, 'folder') and project.folder:
                tox_path = os.path.join(project.folder, 'td_vscode_bridge.tox')
                bridge_comp.save(tox_path)
                print(f" [TD_VSCODE_BRIDGE] Exported .tox: {tox_path}")
        except Exception:
            pass

        print("=" * 65)
        print(" [TD_VSCODE_BRIDGE] Installed successfully!")
        print(f" [TD_VSCODE_BRIDGE] Operator:  {bridge_comp.path}")
        print(f" [TD_VSCODE_BRIDGE] WebSocket: ws://127.0.0.1:{port}")
        print("=" * 65)
        return bridge_comp

    except Exception as e:
        print(f"[TD_VSCODE_BRIDGE] Installation failed: {e}")
        import traceback
        traceback.print_exc()
        return None

# Auto-execute if run inside TouchDesigner
install()

"""
Comprehensive tests for TouchDesigner Bridge Python server and installer.
Runs in a simulated TouchDesigner environment.
"""

import sys
import os
import json
import unittest

# Add workspace root to path
workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, workspace_root)


class MockParam:
    def __init__(self, name, val, label=None, page='Default', style='Float', is_custom=False):
        self.name = name
        self._val = val
        self.label = label or name.capitalize()
        self.page = type('Page', (), {'name': page})()
        self.style = style
        self.isCustom = is_custom
        self.readOnly = False
        self.menuNames = []
        self.menuLabels = []
        self.pulsed = False

    @property
    def val(self):
        return self._val

    @val.setter
    def val(self, v):
        self._val = v

    def eval(self):
        return self._val

    def pulse(self):
        self.pulsed = True


class MockOp:
    def __init__(self, name, path, family='COMP', op_type='base', is_comp=False, is_dat=False, parent=None):
        self.name = name
        self.path = path
        self.family = family
        self.type = op_type
        self.isCOMP = is_comp
        self.isDAT = is_dat
        self.isTable = False
        self.parent = parent
        self.children = []
        self.dependents = []
        self._pars = {}
        self.text = ""
        self._errors = None
        self._warnings = None
        self.cooked = False
        self.cook_count = 0
        self.extensions = []
        self.saved_to = None

    def pars(self):
        return list(self._pars.values())

    @property
    def par(self):
        class ParAccessor:
            def __init__(self, pars):
                self.__dict__['_pars'] = pars
            def __getattr__(self, name):
                if name in self._pars:
                    return self._pars[name]
                raise AttributeError(f"Parameter '{name}' not found")
            def __setattr__(self, name, value):
                if name in self._pars:
                    self._pars[name]._val = value
                    self._pars[name].val = value
                else:
                    p = MockParam(name, value)
                    self._pars[name] = p
            def __hasattr__(self, name):
                return name in self._pars
        return ParAccessor(self._pars)

    def add_param(self, name, val, **kwargs):
        p = MockParam(name, val, **kwargs)
        self._pars[name] = p
        return p

    def errors(self):
        return self._errors

    def warnings(self):
        return self._warnings

    def cook(self, force=False):
        self.cooked = True
        self.cook_count += 1

    def op(self, name):
        for c in self.children:
            if c.name == name:
                return c
        return None

    def create(self, op_type, name):
        is_comp = op_type in ('base', 'baseCOMP')
        is_dat = op_type in ('text', 'textDAT', 'webserver', 'webserverDAT')
        child = MockOp(
            name=name,
            path=f"{self.path.rstrip('/')}/{name}",
            family='DAT' if is_dat else 'COMP',
            op_type=str(op_type),
            is_comp=is_comp,
            is_dat=is_dat,
            parent=self
        )
        if op_type in ('webserver', 'webserverDAT'):
            child.add_param('port', 9988)
            child.add_param('callbacks', '')
            child.add_param('active', 1)
            child.add_param('restart', 0)
        self.children.append(child)
        return child

    def save(self, file_path):
        self.saved_to = file_path


class MockWebServerDAT:
    def __init__(self):
        self.sent_messages = []
        self.par = type('Par', (), {'port': MockParam('port', 9988)})()

    def webSocketSendText(self, client, text):
        self.sent_messages.append((client, json.loads(text)))


class SimulatedTouchDesigner:
    """Sets up a complete mock TouchDesigner environment in Python globals."""
    def __init__(self):
        self.ops = {}
        self.root = MockOp('/', '/', family='COMP', op_type='root', is_comp=True)
        self.project1 = MockOp('project1', '/project1', family='COMP', op_type='base', is_comp=True, parent=self.root)
        self.root.children.append(self.project1)
        self.ops['/'] = self.root
        self.ops['/project1'] = self.project1

        # Add a Python script DAT
        self.script1 = MockOp('script1', '/project1/script1', family='DAT', op_type='text', is_dat=True, parent=self.project1)
        self.script1.text = "print('Hello from script1')\n"
        self.project1.children.append(self.script1)
        self.ops['/project1/script1'] = self.script1

        # Add a GLSL TOP and dependent pixel shader DAT
        self.glsl1_pixel = MockOp('glsl1_pixel', '/project1/glsl1_pixel', family='DAT', op_type='text', is_dat=True, parent=self.project1)
        self.glsl1_pixel.text = "void main() { fragColor = vec4(1.0); }"
        self.project1.children.append(self.glsl1_pixel)
        self.ops['/project1/glsl1_pixel'] = self.glsl1_pixel

        self.glsl1 = MockOp('glsl1', '/project1/glsl1', family='TOP', op_type='glsl', is_comp=False, parent=self.project1)
        self.glsl1.add_param('loadpulse', 0)
        self.project1.children.append(self.glsl1)
        self.ops['/project1/glsl1'] = self.glsl1

        # Link glsl1 as a dependent of glsl1_pixel
        self.glsl1_pixel.dependents.append(self.glsl1)

        # Mock TD globals
        self.app = type('App', (), {'version': '2023.11880', 'build': '11880', 'osName': 'macOS'})()
        self.project = type('Project', (), {'name': 'TestShow.toe', 'folder': '/tmp/td_project'})()
        self.ui = type('UI', (), {'panes': type('Panes', (), {'current': None})()})()
        self.tdu = type('TDU', (), {})()
        self.absTime = type('AbsTime', (), {'frame': 120, 'seconds': 2.0})()
        self.runs = []
        self.mod = type('Mod', (), {})()

    def op(self, path):
        if not path:
            return None
        if path.startswith('/'):
            return self.ops.get(path)
        # Relative lookup in project1
        return self.ops.get(f"/project1/{path}")


class TestBridge(unittest.TestCase):
    def setUp(self):
        self.td = SimulatedTouchDesigner()

        # Inject into builtins so bridge functions see them naturally
        import builtins
        builtins.op = self.td.op
        builtins.root = self.td.root
        builtins.app = self.td.app
        builtins.project = self.td.project
        builtins.ui = self.td.ui
        builtins.tdu = self.td.tdu
        builtins.absTime = self.td.absTime
        builtins.runs = self.td.runs
        builtins.mod = self.td.mod

        from td_component import td_vscode_bridge
        self.bridge = td_vscode_bridge
        self.mock_server = MockWebServerDAT()

    def send_request(self, req_dict):
        self.mock_server.sent_messages.clear()
        self.bridge.onWebSocketReceiveText(self.mock_server, 'client_1', json.dumps(req_dict))
        self.assertTrue(len(self.mock_server.sent_messages) > 0, "Server must send a response")
        return self.mock_server.sent_messages[-1][1]

    def test_ping(self):
        res = self.send_request({'id': 'req-1', 'action': 'ping'})
        self.assertTrue(res['success'])
        self.assertEqual(res['version'], '0.5.0')
        self.assertEqual(res['tdVersion'], '2023.11880')
        self.assertEqual(res['tdBuild'], '11880')
        self.assertEqual(res['projectName'], 'TestShow.toe')

    def test_eval_simple_expression(self):
        res = self.send_request({
            'id': 'req-2',
            'action': 'eval',
            'code': '40 + 2'
        })
        self.assertTrue(res['success'])
        self.assertEqual(res['result'], 42)
        self.assertEqual(res['resultType'], 'int')

    def test_eval_multiline_script_with_stdout(self):
        code = "a = [1, 2, 3]\nprint('SUM:', sum(a))\n"
        res = self.send_request({
            'id': 'req-3',
            'action': 'eval',
            'code': code
        })
        self.assertTrue(res['success'])
        self.assertIn('SUM: 6', res['stdout'])
        self.assertEqual(res['resultType'], 'None')

    def test_eval_syntax_error(self):
        res = self.send_request({
            'id': 'req-4',
            'action': 'eval',
            'code': 'def invalid( syntax'
        })
        self.assertFalse(res['success'])
        self.assertIn('SyntaxError', res['traceback'])

    def test_eval_runtime_exception(self):
        res = self.send_request({
            'id': 'req-5',
            'action': 'eval',
            'code': '1 / 0'
        })
        self.assertFalse(res['success'])
        self.assertIn('ZeroDivisionError', res['traceback'])
        self.assertEqual(res['error'], 'division by zero')

    def test_get_op_tree(self):
        res = self.send_request({
            'id': 'req-6',
            'action': 'get_op_tree',
            'rootPath': '/',
            'depth': 2
        })
        self.assertTrue(res['success'])
        self.assertTrue(len(res['tree']) > 0)
        p1_node = next((n for n in res['tree'] if n['name'] == 'project1'), None)
        self.assertIsNotNone(p1_node)
        self.assertTrue(p1_node['hasChildren'])

    def test_get_op_params(self):
        # Add test params to glsl1
        self.td.glsl1.add_param('reset', 0, label='Reset Filter', style='Pulse')
        self.td.glsl1.add_param('customval', 3.14, label='Custom Val', is_custom=True)

        res = self.send_request({
            'id': 'req-7',
            'action': 'get_op_params',
            'path': '/project1/glsl1'
        })
        self.assertTrue(res['success'])
        param_names = [p['name'] for p in res['params']]
        self.assertIn('reset', param_names)
        self.assertIn('customval', param_names)

        custom_p = next(p for p in res['params'] if p['name'] == 'customval')
        self.assertTrue(custom_p['isCustom'])
        self.assertEqual(custom_p['val'], 3.14)

    def test_sync_dat_python(self):
        new_text = "print('Updated script content')\n"
        res = self.send_request({
            'id': 'req-8',
            'action': 'sync_dat',
            'path': '/project1/script1',
            'content': new_text
        })
        self.assertTrue(res['success'])
        self.assertEqual(self.td.script1.text, new_text)

    def test_sync_dat_glsl_autopulse_reload(self):
        # Saving shader text in glsl1_pixel should pulse loadpulse on dependent glsl1
        new_shader = "out vec4 fragColor;\nvoid main() { fragColor = vec4(0.5); }\n"
        self.td.glsl1.par.loadpulse.pulsed = False

        res = self.send_request({
            'id': 'req-9',
            'action': 'sync_dat',
            'path': '/project1/glsl1_pixel',
            'content': new_shader
        })
        self.assertTrue(res['success'])
        self.assertIn('/project1/glsl1', res.get('reloadedOps', []))
        self.assertTrue(self.td.glsl1.par.loadpulse.pulsed, "Dependent GLSL TOP loadpulse must be pulsed")
        self.assertTrue(self.td.glsl1.cooked, "Dependent GLSL TOP must be cooked")

    def test_sync_dat_glsl_compile_errors_returned(self):
        # Simulate GLSL shader compile error on dependent glsl1
        self.td.glsl1._errors = "0(14) : error C1008: undefined variable \"missingVar\""

        res = self.send_request({
            'id': 'req-10',
            'action': 'sync_dat',
            'path': '/project1/glsl1_pixel',
            'content': "void main() { missingVar = 1.0; }"
        })
        self.assertTrue(res['success'])
        errors = res.get('compileErrors', [])
        self.assertTrue(len(errors) > 0, "Must return compile errors")
        self.assertEqual(errors[0]['path'], '/project1/glsl1')
        self.assertIn('undefined variable', errors[0]['error'])

    def test_fetch_dat(self):
        res = self.send_request({
            'id': 'req-11',
            'action': 'fetch_dat',
            'path': '/project1/script1'
        })
        self.assertTrue(res['success'])
        self.assertEqual(res['content'], self.td.script1.text)

    def test_cook_op(self):
        self.td.glsl1.cooked = False
        res = self.send_request({
            'id': 'req-12',
            'action': 'cook_op',
            'path': '/project1/glsl1'
        })
        self.assertTrue(res['success'])
        self.assertTrue(self.td.glsl1.cooked)

    def test_set_op_param(self):
        self.td.glsl1.add_param('brightness', 0.5)
        res = self.send_request({
            'id': 'req-13',
            'action': 'set_op_param',
            'path': '/project1/glsl1',
            'param': 'brightness',
            'val': 1.25
        })
        self.assertTrue(res['success'])
        self.assertEqual(self.td.glsl1.par.brightness.eval(), 1.25)

    def test_pulse_op_param(self):
        self.td.glsl1.add_param('reset', 0)
        self.td.glsl1.par.reset.pulsed = False
        res = self.send_request({
            'id': 'req-14',
            'action': 'pulse_op_param',
            'path': '/project1/glsl1',
            'param': 'reset'
        })
        self.assertTrue(res['success'])
        self.assertTrue(self.td.glsl1.par.reset.pulsed)

    def test_batch_fetch_dats(self):
        res = self.send_request({
            'id': 'req-15',
            'action': 'batch_fetch_dats',
            'rootPath': '/project1'
        })
        self.assertTrue(res['success'])
        paths = [item['path'] for item in res['items']]
        self.assertIn('/project1/script1', paths)
        self.assertIn('/project1/glsl1_pixel', paths)

    def test_apply_param_snapshot(self):
        self.td.glsl1.add_param('contrast', 1.0)
        self.td.glsl1.add_param('gamma', 1.0)
        res = self.send_request({
            'id': 'req-16',
            'action': 'apply_param_snapshot',
            'path': '/project1/glsl1',
            'snapshot': {
                'contrast': 2.0,
                'gamma': 1.5
            }
        })
        self.assertTrue(res['success'])
        self.assertEqual(res['appliedCount'], 2)
        self.assertEqual(self.td.glsl1.par.contrast.eval(), 2.0)
        self.assertEqual(self.td.glsl1.par.gamma.eval(), 1.5)

    def test_installer_in_simulated_touchdesigner(self):
        from td_component import install_bridge
        comp = install_bridge.install(parent_op=self.td.project1, port=9988)
        self.assertIsNotNone(comp)
        self.assertEqual(comp.name, 'td_vscode_bridge')

        # Check that callbacks DAT and webserver DAT were created inside the COMP
        callbacks = comp.op('callbacks')
        self.assertIsNotNone(callbacks)
        self.assertIn('onWebSocketReceiveText', callbacks.text)

        webserver = comp.op('webserver1')
        self.assertIsNotNone(webserver)
        self.assertEqual(webserver.par.port.eval(), 9988)
        self.assertEqual(webserver.par.callbacks.eval(), 'callbacks')


if __name__ == '__main__':
    unittest.main()

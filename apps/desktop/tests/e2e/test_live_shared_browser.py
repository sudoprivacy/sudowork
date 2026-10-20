import unittest

from live_shared_browser import is_main_renderer_target


class MainRendererTargetTests(unittest.TestCase):
    def test_recognizes_packaged_and_vite_renderers(self):
        self.assertTrue(is_main_renderer_target({
            'type': 'page',
            'url': 'file:///Applications/Sudowork.app/Contents/Resources/app.asar/renderer/index.html#/guid',
        }))
        self.assertTrue(is_main_renderer_target({
            'type': 'page',
            'url': 'http://localhost:5173/#/guid',
        }))
        self.assertTrue(is_main_renderer_target({
            'type': 'page',
            'url': 'http://127.0.0.1:5173/#/conversation/example',
        }))

    def test_rejects_non_main_cdp_targets(self):
        self.assertFalse(is_main_renderer_target({
            'type': 'page',
            'url': 'http://localhost:5173/#/browser-viewer/example',
        }))
        self.assertFalse(is_main_renderer_target({
            'type': 'page',
            'url': 'http://localhost:5173/#/browser-controls/example',
        }))
        self.assertFalse(is_main_renderer_target({
            'type': 'page',
            'url': 'devtools://devtools/bundled/devtools_app.html',
        }))
        self.assertFalse(is_main_renderer_target({
            'type': 'worker',
            'url': 'http://localhost:5173/',
        }))


if __name__ == '__main__':
    unittest.main()

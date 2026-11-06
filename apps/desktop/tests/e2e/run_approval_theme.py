"""Exercise the real shared approval UI and computed theme in an owned browser.

Start the approval_theme Vite fixture (desktop or APPROVAL_THEME_HOST=webui),
then pass a fresh ai-dev-browser session ID. No agent or real approval is sent.
Run with the Python environment containing ai-dev-browser.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--session-id', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


def call(tool, **options):
    command = [sys.executable, '-m', f'ai_dev_browser.tools.{tool}', '--session-id', args.session_id]
    for key, value in options.items():
        command += ['--' + key.replace('_', '-'), str(value)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr
    data = json.loads(result.stdout)
    assert not data.get('error'), data
    return data


def evaluate(expression):
    return call('js_evaluate', expression=expression)['result']


CONTRAST_HELPERS = r"""
  const rgba = color => color.match(/[\d.]+/g).map(Number);
  const composite = (foreground, background) => foreground.slice(0, 3).map((x, i) => x * (foreground[3] ?? 1) + background[i] * (1 - (foreground[3] ?? 1)));
  const background = element => {
    const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    return ancestors.reduce((color, node) => composite(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255]);
  };
  const luminance = color => color.map(x => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((a, x, i) => a + x * [.2126, .7152, .0722][i], 0);
  const read = (name, element) => {
    const style = getComputedStyle(element), bg = background(element);
    const a = luminance(composite(rgba(style.color), bg)), b = luminance(bg);
    return { name, color: style.color, background: bg, contrast: (Math.max(a,b)+.05)/(Math.min(a,b)+.05) };
  };
"""
MEASURE = "(() => {" + CONTRAST_HELPERS + r"""
  const panel = document.querySelector('section[aria-label="Allow this command?"]');
  const actions = [...panel.querySelectorAll('button')];
  const rows = [read('title', panel.querySelector('.arco-ellipsis-content')), read('description', panel.querySelectorAll('.arco-ellipsis-content')[1]), ...actions.map((button, i) => read('action'+i, button)), read('shortcut', panel.querySelector('kbd'))];
  const body = getComputedStyle(document.body);
  return { theme: document.documentElement.dataset.theme, rows, opaque: getComputedStyle(panel).backgroundColor, aliases: { foreground: body.getPropertyValue('--foreground').trim(), arcoText: body.getPropertyValue('--color-text-1').trim(), elevated: body.getPropertyValue('--bg-elevated').trim(), popup: body.getPropertyValue('--color-bg-popup').trim() }, overflow: document.documentElement.scrollWidth > innerWidth };
})()"""

call('page_goto', url=evaluate('location.href'))
report = []
for theme in ['dark', 'light']:
    call('click_by_text', text=theme)
    call('click_by_text', text='Request approval')
    measured = evaluate(MEASURE)
    assert measured['theme'] == theme
    assert not measured['overflow'], measured
    assert measured['aliases']['foreground'] == measured['aliases']['arcoText'], measured
    assert measured['aliases']['elevated'] == measured['aliases']['popup'], measured
    assert all(row['contrast'] >= 4.5 for row in measured['rows']), measured
    call('page_screenshot', path=args.output / f'{theme}-approval.png')
    call('click_by_text', text='Reject')
    assert evaluate('document.body.dataset.decision') == 'cancel'
    assert evaluate('document.querySelector("input[aria-label=Draft]").value') == 'Keep this draft'
    call('click_by_text', text='Request saved login')
    portal = evaluate("(() => {" + CONTRAST_HELPERS + "const node = document.querySelector('.arco-modal'); return { parent: node.closest('#root') ? 'root' : 'body-portal', rows: [read('title', node.querySelector('.arco-modal-title')), read('description', node.querySelector('.arco-modal-content > div'))] }; })()")
    assert portal['parent'] == 'body-portal', portal
    assert all(row['contrast'] >= 4.5 for row in portal['rows']), portal
    call('page_screenshot', path=args.output / f'{theme}-login.png')
    call('click_by_text', text='Reject once')
    assert evaluate('document.body.dataset.decision') == 'reject_once'
    measured['login_portal'] = portal
    report.append(measured)

(args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'themes': report}, indent=2))

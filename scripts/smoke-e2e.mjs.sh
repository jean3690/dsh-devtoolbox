#!/bin/bash
# End-to-end smoke: open toolbox, run the json_format tool, verify result.
# Class names are CSS-Modules-hashed, so selectors target the plugin's data
# attributes and button text instead of class names.
set -u
P() { playwright-cli --raw "$@" 2>&1; }

P open http://127.0.0.1:3080 > /dev/null 2>&1
sleep 2

echo "--- open toolbox ---"
P eval "(() => { const el = document.querySelector('[data-dsh-toolbox-entry]'); if (!el) return 'no-entry'; el.click(); return 'opened' })()"
sleep 1

echo "--- find and open json_format card ---"
P eval "(() => { const cards = [...document.querySelectorAll('[data-dsh-toolbox-view] button')]; const c = cards.find(x => x.textContent.includes('JSON 工具') || x.textContent.includes('JSON tool')); if (!c) return 'no-card'; c.click(); return 'opened card' })()"
sleep 1

echo "--- fill textarea and run ---"
P eval "(() => { const ta = document.getElementById('tb-json_format-text'); if (!ta) return 'no-textarea'; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, '{\"a\":1,\"b\":[1,2]}'); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'filled' })()"
sleep 1
P eval "(() => { const b = [...document.querySelectorAll('[data-dsh-toolbox-view] button')].find(x => x.textContent.includes('运行') || x.textContent.includes('Run')); if (!b) return 'no-run'; b.click(); return 'ran' })()"
sleep 1

echo "--- verify result ---"
P eval "(() => { const pre = document.querySelector('[data-dsh-toolbox-view] pre'); return pre ? pre.textContent.slice(0, 60) : 'no-result' })()"

echo "--- style tags and tokens ---"
P eval "JSON.stringify([...document.querySelectorAll('style[data-plugin-css]')].map(s => s.dataset.pluginCss))"

echo "--- back to grid, then back to chat ---"
P eval "(() => { const b = [...document.querySelectorAll('[data-dsh-toolbox-view] button')].find(x => x.textContent.includes('返回') || x.textContent.includes('Back')); if (!b) return 'no-back'; b.click(); return 'back' })()"
sleep 1
P eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回对话')); if (!b) return 'no-close'; b.click(); return 'closed' })()"
sleep 1
P eval "JSON.stringify({active: document.documentElement.getAttribute('data-dsh-toolbox-active'), viewDisplay: getComputedStyle(document.querySelector('[data-dsh-toolbox-view]')).display})"

P close > /dev/null 2>&1
echo done

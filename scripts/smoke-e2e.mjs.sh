#!/bin/bash
# End-to-end smoke: open toolbox, run the json_format tool, verify result
set -u
P() { playwright-cli --raw "$@" 2>&1; }

P open http://127.0.0.1:3080 > /dev/null 2>&1
sleep 2

echo "--- open toolbox ---"
P eval "(() => { const el = document.querySelector('[data-dsh-toolbox-entry]'); el.click(); return 'opened' })()"
sleep 1

echo "--- find and open json_format card ---"
P eval "(() => { const cards = [...document.querySelectorAll('.dsh-toolbox-card')]; const c = cards.find(x => x.textContent.includes('JSON 工具') || x.textContent.includes('JSON tool')); if (!c) return 'no-card: ' + cards.length; c.click(); return 'opened card' })()"
sleep 1

echo "--- fill textarea and run ---"
P eval "(() => { const ta = document.getElementById('tb-json_format-text'); if (!ta) return 'no-textarea'; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, '{\"a\":1,\"b\":[1,2]}'); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'filled' })()"
sleep 1
P eval "(() => { const b = [...document.querySelectorAll('.dsh-toolbox-run')].find(x => x.textContent.includes('运行') || x.textContent.includes('Run')); if (!b) return 'no-run'; b.click(); return 'ran' })()"
sleep 1

echo "--- verify result ---"
P eval "(() => { const pre = document.querySelector('.dsh-toolbox-pre'); return pre ? pre.textContent.slice(0, 60) : 'no-result' })()"

echo "--- back to grid, then back to chat ---"
P eval "(() => { const b = [...document.querySelectorAll('.dsh-toolbox-back')].find(x => x.textContent.includes('返回') || x.textContent.includes('Back')); b.click(); return 'back' })()"
sleep 1
P eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回对话')); b.click(); return 'closed' })()"
sleep 1
P eval "JSON.stringify({active: document.documentElement.getAttribute('data-dsh-toolbox-active'), viewDisplay: getComputedStyle(document.querySelector('[data-dsh-toolbox-view]')).display})"

P close > /dev/null 2>&1
echo done

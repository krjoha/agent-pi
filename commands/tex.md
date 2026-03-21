---
description: "Open Text Tools — lightweight text manipulation app with stackable operations and diff view"
allowed-tools: ["Bash"]
---

Open the Text Tools app in the browser. Run this command, replacing the path with the agent-pi repo location from Pi settings:

```bash
PI_PKG=$(node -e "const s=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.pi/agent/settings.json','utf-8'));const p=s.packages.find(p=>p.includes('agent-pi'));console.log(p||'')")
open "$PI_PKG/tex/index.html"
```

Report back: "Text Tools opened in browser."

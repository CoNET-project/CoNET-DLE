# Isolated DLE 30-day lab

This directory is the **only** runtime surface allowed on the seven assigned hosts.

- Home: `/home/peter/dle-30d-lab`
- Port: `27101` only (lab quorum). Cloud firewall already allows inbound TCP 27101 on all seven hosts.
- Process: `node /home/peter/dle-30d-lab/app/archive/lab-cli.js` (`command: archive`; rolling-compat `agent: dle-30d-lab`). Old `agent.mjs` is leftover only.
- Deploy / accept from compiled pilot CLI: `cd pilot && npm run build && node dist/src/cli.js lab-deploy-archive` then `lab-accept-archive`. Do not use root `tsx pilot/src/cli.ts` (inventory path is wrong).
- Billing: **USD 4 / host / month**, unmetered traffic (invoice `inv-conet-dle-30d-lab-2026-08-host-month`, subtotal **USD 28**)
- Never stop, start, or restart `geth`, `beacon-chain`, or `validator`
- Deprecated L1 hosts must never `start-with-va`

SSH inventory is `hosts.json`. Public evidence must not include raw IPs.

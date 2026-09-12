#!/bin/zsh
cd "${0:A:h}"
if curl -fsS http://localhost:4173/api/feed -o /dev/null --max-time 3; then
  open http://localhost:4173
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm install || exit 1
fi
if [[ ! -d dist ]]; then
  npm run build || exit 1
fi
(
  for attempt in {1..30}; do
    if curl -fsS http://localhost:4173/ -o /dev/null --max-time 1; then
      open http://localhost:4173
      break
    fi
    sleep 1
  done
) &
npm start

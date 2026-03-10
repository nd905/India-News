import { writeFileSync } from 'node:fs'

writeFileSync('dist/.assetsignore', '_worker.js\n_routes.json\n')

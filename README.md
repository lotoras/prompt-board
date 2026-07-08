# test-app

An Electron application with React and TypeScript

## Native deps

`node-pty` ships prebuilt N-API binaries and works out of the box. Only run `npm run rebuild:pty`
if the prebuilt binary ever mismatches the pinned Electron ABI (requires VS Build Tools + Python).

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

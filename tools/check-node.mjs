const version = process.versions.node;
const [major, minor] = version.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 12);

if (!supported) {
  console.error(`
[环境检查] 当前 Node.js 版本为 ${version}，不受本项目支持。

项目使用的 Vite 8、Rolldown 和 puppeteer-core 要求 Node.js >= 22.12.0。
请先升级 Node.js，再删除旧依赖并重新按锁文件安装：

  nvm install 24.21.0
  nvm use 24.21.0
  node -v
  Remove-Item -Recurse -Force node_modules
  npm ci
  npm run dev

如果终端提示符带有 (base)，请先执行 conda deactivate，避免 Conda 自带的旧 Node.js 覆盖 nvm 版本。
仅升级 Node.js 而不重新安装依赖，仍可能缺失 Windows 原生模块。
`.trim());
  process.exit(1);
}

console.log(`[环境检查] Node.js ${version} 符合要求（>= 22.12.0）。`);

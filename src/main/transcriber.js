// ============================================
// MagicWhisper — Whisper.cpp Transcription Engine
// ============================================
// Downloads or compiles whisper.cpp binary, then
// uses it to transcribe audio files locally.
// All operations logged via the centralized logger.
// ============================================

const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { app } = require('electron');
const { logger } = require('./logger');

// Extended PATH for macOS (Electron apps have minimal PATH)
const EXTENDED_PATH = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  '/Library/Apple/usr/bin',
  process.env.PATH || ''
].join(':');

const SHELL_ENV = {
  ...process.env,
  PATH: process.platform === 'darwin' ? EXTENDED_PATH : process.env.PATH,
  HOMEBREW_NO_AUTO_UPDATE: '1'
};

class Transcriber {
  constructor(binDir, modelsDir) {
    this.binDir = binDir;
    this.modelsDir = modelsDir;
    this.cudaBinDir = path.join(this.binDir, 'cuda');
    this.binaryPath = this.getBinaryPath();

    fs.mkdirSync(this.binDir, { recursive: true });
    fs.mkdirSync(this.cudaBinDir, { recursive: true });
    fs.mkdirSync(this.modelsDir, { recursive: true });

    logger.info('transcriber', 'Transcriber initialized', {
      binDir: this.binDir,
      modelsDir: this.modelsDir,
      binaryPath: this.binaryPath,
      binaryExists: this.binaryExists()
    });
  }

  getBinaryPath() {
    const binaryName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    return path.join(this.binDir, binaryName);
  }

  getCudaBinaryPath() {
    const binaryName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    return path.join(this.cudaBinDir, binaryName);
  }

  binaryExists() {
    return fs.existsSync(this.binaryPath);
  }

  cudaBinaryExists() {
    return fs.existsSync(this.getCudaBinaryPath());
  }

  isReady() {
    return this.binaryExists();
  }

  getAccelerationStatus() {
    const cudaFiles = this.cudaBinaryExists()
      ? fs.readdirSync(this.cudaBinDir).filter(file => file.toLowerCase().endsWith('.dll') || file.toLowerCase().endsWith('.exe'))
      : [];

    return {
      cpuReady: this.binaryExists(),
      cudaReady: this.cudaBinaryExists(),
      cudaBinDir: this.cudaBinDir,
      cudaFiles,
      activeDefault: this.cudaBinaryExists() ? 'cuda' : 'cpu'
    };
  }

  // ─── Setup Pipeline ───────────────────────────────────────

  async setup(progressCallback) {
    logger.info('transcriber', 'Starting setup...');
    if (progressCallback) progressCallback({ stage: 'binary', message: 'Starting setup...' });

    try {
      // Try downloading pre-built binary first
      try {
        if (progressCallback) progressCallback({ stage: 'binary', message: 'Downloading pre-built whisper binary...' });
        await this.downloadPrebuiltBinary(progressCallback);
        logger.info('transcriber', 'Pre-built binary downloaded successfully');
        if (progressCallback) progressCallback({ stage: 'done', message: 'Setup complete!' });
        return true;
      } catch (dlErr) {
        logger.warn('transcriber', 'Pre-built download failed, falling back to compilation', { error: dlErr.message });
      }

      // Fallback: compile from source
      if (progressCallback) progressCallback({ stage: 'binary', message: 'Compiling whisper.cpp from source...' });
      await this.compileBinary(progressCallback);
      logger.info('transcriber', 'Binary compiled from source successfully');
      if (progressCallback) progressCallback({ stage: 'done', message: 'Setup complete!' });
      return true;
    } catch (err) {
      logger.error('transcriber', 'Setup failed', { error: err.message, stack: err.stack });
      throw err;
    }
  }

  // ─── Pre-built Binary Download ────────────────────────────

  async downloadPrebuiltBinary(progressCallback) {
    const platform = process.platform;
    const arch = process.arch;

    if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    logger.info('transcriber', 'Fetching latest release info from GitHub');
    if (progressCallback) progressCallback({ stage: 'binary', message: 'Finding latest release...' });

    const releaseInfo = await this.fetchJSON('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest');
    const tag = releaseInfo.tag_name;
    logger.info('transcriber', `Latest release: ${tag}`, { assets: (releaseInfo.assets || []).length });

    // Find matching asset
    let assetPattern;
    if (platform === 'darwin') {
      assetPattern = arch === 'arm64'
        ? /macos.*arm64|darwin.*arm64|macos.*aarch64/
        : /macos.*x86_64|darwin.*x64/;
    } else if (platform === 'win32') {
      assetPattern = /win.*x64|windows.*x64|whisper-bin-x64/;
    } else {
      assetPattern = /linux.*x64|linux.*amd64/;
    }

    let downloadUrl = null;
    let assetName = null;

    for (const asset of releaseInfo.assets || []) {
      const name = asset.name.toLowerCase();
      if (assetPattern.test(name) && (name.endsWith('.zip') || name.endsWith('.tar.gz'))) {
        downloadUrl = asset.browser_download_url;
        assetName = asset.name;
        break;
      }
    }

    // Fallback: generic bin package
    if (!downloadUrl) {
      for (const asset of releaseInfo.assets || []) {
        const name = asset.name.toLowerCase();
        if (name.includes('bin') && platform === 'darwin' && name.includes('mac')) {
          downloadUrl = asset.browser_download_url;
          assetName = asset.name;
          break;
        }
      }
    }

    if (!downloadUrl) {
      throw new Error(`No pre-built binary found for ${platform}-${arch} in release ${tag}`);
    }

    logger.info('transcriber', `Downloading ${assetName}`, { url: downloadUrl });
    if (progressCallback) progressCallback({ stage: 'binary', message: `Downloading ${assetName}...` });

    const tmpFile = path.join(os.tmpdir(), assetName);
    await this.downloadFile(downloadUrl, tmpFile);

    // Extract
    if (progressCallback) progressCallback({ stage: 'binary', message: 'Extracting...' });
    const extractDir = path.join(os.tmpdir(), `magicwhisper-extract-${Date.now()}`);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });

    if (assetName.endsWith('.zip')) {
      if (process.platform === 'win32') {
        await this.execShell(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${tmpFile}' -DestinationPath '${extractDir}'"`);
      } else {
        await this.execShell(`unzip -o "${tmpFile}" -d "${extractDir}"`);
      }
    } else {
      await this.execShell(`tar xzf "${tmpFile}" -C "${extractDir}"`);
    }

    // Find binary
    const binary = this.findBinaryInDir(extractDir);
    if (!binary) {
      throw new Error('Could not find whisper-cli in downloaded archive');
    }

    fs.copyFileSync(binary, this.binaryPath);
    fs.chmodSync(this.binaryPath, 0o755);

    if (process.platform === 'win32') {
      const binaryDir = path.dirname(binary);
      const entries = fs.readdirSync(binaryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll')) {
          fs.copyFileSync(path.join(binaryDir, entry.name), path.join(this.binDir, entry.name));
        }
      }
    }

    // Cleanup
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) {}

    logger.info('transcriber', 'Binary installed successfully', { path: this.binaryPath });
    if (progressCallback) progressCallback({ stage: 'binary', message: 'Binary installed successfully!' });
  }

  async setupCuda(progressCallback) {
    if (process.platform !== 'win32') {
      throw new Error('CUDA acceleration setup is currently supported only on Windows.');
    }

    logger.info('transcriber', 'Starting CUDA backend setup...');
    if (progressCallback) progressCallback({ stage: 'gpu', message: 'Finding CUDA whisper.cpp backend...' });

    const releaseInfo = await this.fetchJSON('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest');
    const tag = releaseInfo.tag_name;
    const assets = releaseInfo.assets || [];

    const preferredAssets = [
      /whisper-cublas-12\.[0-9.]+-bin-x64\.zip/i,
      /whisper-cublas-11\.[0-9.]+-bin-x64\.zip/i
    ];

    let asset = null;
    for (const pattern of preferredAssets) {
      asset = assets.find(item => pattern.test(item.name));
      if (asset) break;
    }

    if (!asset) {
      throw new Error(`No CUDA/cuBLAS Windows x64 backend found in whisper.cpp ${tag}.`);
    }

    logger.info('transcriber', 'Downloading CUDA backend', { tag, asset: asset.name });
    if (progressCallback) progressCallback({ stage: 'gpu', message: `Downloading ${asset.name}...` });

    const tmpFile = path.join(os.tmpdir(), asset.name);
    const extractDir = path.join(os.tmpdir(), `magicwhisper-cuda-${Date.now()}`);

    await this.downloadFile(asset.browser_download_url, tmpFile);

    try {
      if (progressCallback) progressCallback({ stage: 'gpu', message: 'Extracting CUDA backend...' });
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      fs.mkdirSync(extractDir, { recursive: true });

      await this.execShell(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${tmpFile}' -DestinationPath '${extractDir}'"`);

      if (fs.existsSync(this.cudaBinDir)) {
        fs.rmSync(this.cudaBinDir, { recursive: true, force: true });
      }
      fs.mkdirSync(this.cudaBinDir, { recursive: true });

      const binary = this.findBinaryInDir(extractDir);
      if (!binary) throw new Error('Could not find whisper-cli.exe in CUDA backend archive.');

      const binaryDir = path.dirname(binary);
      const entries = fs.readdirSync(binaryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const source = path.join(binaryDir, entry.name);
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.exe') || lower.endsWith('.dll')) {
          fs.copyFileSync(source, path.join(this.cudaBinDir, entry.name));
        }
      }

      logger.info('transcriber', 'CUDA backend installed successfully', {
        path: this.getCudaBinaryPath(),
        files: fs.readdirSync(this.cudaBinDir)
      });
      if (progressCallback) progressCallback({ stage: 'done', message: 'CUDA backend installed successfully!' });
      return true;
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) {}
    }
  }

  findBinaryInDir(dir) {
    const names = process.platform === 'win32'
      ? ['whisper-cli.exe', 'whisper-whisper-cli.exe', 'main.exe', 'whisper.exe']
      : ['whisper-cli', 'whisper-whisper-cli', 'main', 'whisper'];

    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    const files = [];

    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = path.join(entry.parentPath || entry.path || dir, entry.name);
        files.push({ name: entry.name, path: fullPath, size: fs.statSync(fullPath).size });
      }
    }

    for (const name of names) {
      const matches = files.filter(f => f.name === name);
      if (matches.length > 0) {
        matches.sort((a, b) => b.size - a.size);
        return matches[0].path;
      }
    }

    // Deeper search with shell find
    try {
      const { execSync } = require('child_process');
      for (const name of names) {
        const result = execSync(`find "${dir}" -name "${name}" -type f 2>/dev/null`, { encoding: 'utf8' }).trim();
        if (result) return result.split('\n')[0];
      }
    } catch (e) {}

    return null;
  }

  // ─── Compile from Source ──────────────────────────────────

  async compileBinary(progressCallback) {
    const tmpDir = path.join(os.tmpdir(), `magicwhisper-build-${Date.now()}`);

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    logger.info('transcriber', 'Cloning whisper.cpp repository');
    if (progressCallback) progressCallback({ stage: 'binary', message: 'Cloning whisper.cpp...' });
    await this.execShell(`git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "${tmpDir}"`);

    logger.info('transcriber', 'Building whisper.cpp');
    if (progressCallback) progressCallback({ stage: 'binary', message: 'Building whisper.cpp (this may take a few minutes)...' });

    const hasCmake = await this.commandExists('cmake');

    if (hasCmake) {
      const buildDir = path.join(tmpDir, 'build');
      fs.mkdirSync(buildDir, { recursive: true });

      const cmakeArgs = ['-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF'];
      if (process.platform === 'darwin') cmakeArgs.push('-DWHISPER_METAL=ON');
      cmakeArgs.push('..');

      await this.execShell(`cd "${buildDir}" && cmake ${cmakeArgs.join(' ')}`);
      await this.execShell(`cd "${buildDir}" && cmake --build . --config Release -j ${os.cpus().length}`);

      const binary = this.findBinaryInDir(buildDir);
      if (!binary) throw new Error('Build succeeded but binary not found');

      fs.copyFileSync(binary, this.binaryPath);

      // Copy Metal shaders or dynamic libraries
      try {
        const buildFiles = fs.readdirSync(buildDir, { recursive: true, withFileTypes: true });
        for (const file of buildFiles) {
          if (file.isFile() && (file.name.endsWith('.metal') || file.name.endsWith('.dylib') || file.name.endsWith('.so') || file.name.endsWith('.dll'))) {
            const filePath = path.join(file.parentPath || file.path || buildDir, file.name);
            fs.copyFileSync(filePath, path.join(this.binDir, file.name));
          }
        }
      } catch (e) {
        logger.warn('transcriber', 'Failed copying auxiliary dependencies', { error: e.message });
      }
    } else {
      if (progressCallback) progressCallback({ stage: 'binary', message: 'Building with make (cmake not found)...' });
      await this.execShell(`cd "${tmpDir}" && make -j ${os.cpus().length}`);

      const binary = this.findBinaryInDir(tmpDir);
      if (!binary) throw new Error('Build succeeded but binary not found');

      fs.copyFileSync(binary, this.binaryPath);
    }

    fs.chmodSync(this.binaryPath, 0o755);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    logger.info('transcriber', 'Binary compiled successfully');
    if (progressCallback) progressCallback({ stage: 'binary', message: 'Binary compiled successfully!' });
  }

  // ─── Transcription ────────────────────────────────────────

  async transcribe(audioBuffer, options = {}) {
    if (!this.binaryExists()) {
      throw new Error('Whisper binary not found. Please run setup first.');
    }

    const modelName = options.model || 'ggml-base.en.bin';
    const modelPath = path.join(this.modelsDir, modelName);

    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model not found: ${modelName}. Please download it from Settings.`);
    }

    const tempWav = path.join(os.tmpdir(), `magicwhisper-${Date.now()}.wav`);
    fs.writeFileSync(tempWav, Buffer.from(audioBuffer));

    const startTime = Date.now();
    logger.info('transcriber', 'Starting transcription', {
      model: modelName,
      language: options.language || 'en',
      audioSize: audioBuffer.byteLength
    });

    try {
      const backend = this.resolveBackend(options);
      const binaryPath = backend === 'cuda' ? this.getCudaBinaryPath() : this.binaryPath;
      const binaryDir = path.dirname(binaryPath);
      const threadCount = this.getThreadCount(options, backend);
      const args = [
        '-m', modelPath,
        '-f', tempWav,
        '-l', options.language || 'en',
        '--no-timestamps',
        '-t', String(threadCount),
        '-bs', '1', // Greedy decoding for raw speed
        '-bo', '1',
        '-mc', this.getMaxContext(options, modelName)
      ];

      if (backend === 'cuda') {
        args.push('-fa');
      }

      const output = await this.execCmd(binaryPath, args, {
        env: {
          ...SHELL_ENV,
          PATH: `${binaryDir}${path.delimiter}${SHELL_ENV.PATH || ''}`,
          CUDA_MODULE_LOADING: 'LAZY'
        }
      });

      let text = output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('[') && !line.includes('BLANK_AUDIO'))
        .join(' ')
        .trim();

      const elapsed = Date.now() - startTime;
      logger.info('transcriber', 'Transcription complete', {
        textLength: text.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        elapsedMs: elapsed,
        model: modelName,
        backend
      });

      return text;
    } catch (err) {
      logger.error('transcriber', 'Transcription failed', {
        error: err.message,
        model: modelName,
        backend: this.resolveBackend(options),
        elapsedMs: Date.now() - startTime
      });
      throw err;
    } finally {
      try { fs.unlinkSync(tempWav); } catch (e) {}
    }
  }

  // ─── Utility Methods ──────────────────────────────────────

  resolveBackend(options = {}) {
    const requested = options.acceleration || 'auto';
    if (requested === 'cpu') return 'cpu';
    if (requested === 'cuda') return this.cudaBinaryExists() ? 'cuda' : 'cpu';

    const model = options.model || '';
    const shouldPreferCuda = model.includes('large-v3') || model.includes('medium') || options.preferGpu === true;
    return shouldPreferCuda && this.cudaBinaryExists() ? 'cuda' : 'cpu';
  }

  getThreadCount(options = {}, backend = 'cpu') {
    if (Number.isInteger(options.threads) && options.threads > 0) {
      return options.threads;
    }

    const logical = os.cpus().length;
    if (backend === 'cuda') {
      return Math.max(4, Math.min(8, Math.floor(logical / 2)));
    }

    return Math.max(1, Math.floor(logical / 2));
  }

  getMaxContext(options = {}, modelName = '') {
    if (Number.isInteger(options.maxContext) && options.maxContext > 0) {
      return String(options.maxContext);
    }

    if (modelName.includes('large-v3')) return '768';
    return '512';
  }

  async commandExists(cmd) {
    return new Promise((resolve) => {
      const probe = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
      exec(probe, { env: SHELL_ENV }, (err) => {
        resolve(!err);
      });
    });
  }

  execShell(command, options = {}) {
    return new Promise((resolve, reject) => {
      exec(command, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 600000,
        env: SHELL_ENV,
        shell: process.platform === 'win32' ? undefined : '/bin/zsh',
        ...options
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error('transcriber', `Shell command failed: ${command.slice(0, 100)}`, { stderr: stderr.slice(0, 500) });
          reject(new Error(`${error.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  execCmd(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(command, args, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 600000,
        env: SHELL_ENV,
        ...options
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error('transcriber', `Command failed: ${command}`, { args: args.join(' '), stderr: stderr.slice(0, 500) });
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  fetchJSON(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, {
        headers: { 'User-Agent': 'MagicWhisper/1.0' }
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          this.fetchJSON(res.headers.location).then(resolve).catch(reject);
          return;
        }
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Failed to parse response')); }
        });
      }).on('error', reject);
    });
  }

  downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const download = (downloadUrl) => {
        const client = downloadUrl.startsWith('https') ? https : http;
        client.get(downloadUrl, {
          headers: { 'User-Agent': 'MagicWhisper/1.0' }
        }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
            download(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const fileStream = fs.createWriteStream(dest);
          res.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); resolve(); });
          fileStream.on('error', reject);
        }).on('error', reject);
      };
      download(url);
    });
  }
}

module.exports = { Transcriber };

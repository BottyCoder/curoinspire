
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Creating project zip file...');

try {
  // Create tmp directory if it doesn't exist
  const tmpDir = '/tmp';
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // Get current date for filename
  const date = new Date().toISOString().split('T')[0];
  const zipName = `curo-inspire-${date}.zip`;
  const zipPath = path.join(tmpDir, zipName);

  // Files and directories to exclude
  const excludeList = [
    'node_modules',
    '.git',
    '.replit',
    'replit.nix',
    '.nvm',
    '.config',
    'attached_assets',
    '*.log',
    'tmp'
  ];

  // Create exclude string for zip command
  const excludeArgs = excludeList.map(item => `-x "${item}/*"`).join(' ');

  // Create the zip file
  const zipCommand = `cd /home/runner/$(basename "$PWD") && zip -r "${zipPath}" . ${excludeArgs}`;
  
  console.log('📦 Creating zip with command:', zipCommand);
  execSync(zipCommand, { stdio: 'inherit' });

  console.log(`✅ Zip file created: ${zipPath}`);
  console.log(`📁 File size: ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB`);
  
  // List tmp directory contents
  console.log('\n📂 /tmp directory contents:');
  const tmpContents = fs.readdirSync(tmpDir);
  tmpContents.forEach(file => {
    const filePath = path.join(tmpDir, file);
    const stats = fs.statSync(filePath);
    console.log(`  ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
  });

} catch (error) {
  console.error('❌ Error creating zip:', error.message);
  process.exit(1);
}

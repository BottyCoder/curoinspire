
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function pushAnalysisToGitHub() {
  try {
    console.log('🔍 Fetching project analysis...');
    
    // Fetch the analysis from localhost since we're running in the same Repl
    const analysisUrl = `http://localhost:3000/api/project-analysis?key=${process.env.ANALYSIS_TOKEN}`;
    
    execSync(`curl -s "${analysisUrl}" -o project-analysis.json`, { stdio: 'inherit' });
    
    if (!fs.existsSync('project-analysis.json')) {
      throw new Error('Failed to download analysis file');
    }
    
    console.log('✅ Analysis downloaded successfully');
    
    // Clean up any stale git lock files
    try {
      execSync('rm -f .git/index.lock .git/refs/heads/main.lock', { stdio: 'pipe' });
    } catch (e) {
      // Ignore errors if files don't exist
    }
    
    // Just set the basics and ignore warnings
    execSync('git config user.name "Replit Bot" 2>/dev/null || true', { stdio: 'pipe' });
    execSync('git config user.email "bot@replit.com" 2>/dev/null || true', { stdio: 'pipe' });
    execSync('git init 2>/dev/null || true', { stdio: 'pipe' });
    
    // Set up remote with authentication if not already configured
    try {
      execSync('git remote get-url origin', { stdio: 'pipe' });
      // Update existing remote to use token
      if (process.env.GH_TOKEN && process.env.GIT_URL) {
        const authenticatedUrl = process.env.GIT_URL.replace('https://', `https://${process.env.GH_TOKEN}@`);
        execSync(`git remote set-url origin ${authenticatedUrl}`, { stdio: 'pipe' });
      }
    } catch {
      if (process.env.GH_TOKEN && process.env.GIT_URL) {
        console.log('🔧 Setting up GitHub remote...');
        const authenticatedUrl = process.env.GIT_URL.replace('https://', `https://${process.env.GH_TOKEN}@`);
        execSync(`git remote add origin ${authenticatedUrl}`, { stdio: 'inherit' });
      } else {
        throw new Error('GH_TOKEN and GIT_URL secrets not configured');
      }
    }
    
    // Create timestamp for commit
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `project-analysis-${timestamp}.json`;
    
    // Rename file with timestamp
    fs.renameSync('project-analysis.json', filename);
    
    // Add and commit
    execSync(`git add ${filename}`, { stdio: 'inherit' });
    execSync(`git commit -m "Add project analysis ${timestamp}"`, { stdio: 'inherit' });
    
    // Push to GitHub
    try {
      execSync('git push origin main', { stdio: 'inherit' });
      console.log(`🚀 Analysis pushed to GitHub as ${filename}`);
    } catch {
      console.log('⚠️ Push failed - check your GH_TOKEN and GIT_URL secrets');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

pushAnalysisToGitHub();

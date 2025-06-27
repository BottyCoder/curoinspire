
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
    
    // Just set the basics and ignore warnings
    execSync('git config user.name "Replit Bot" 2>/dev/null || true', { stdio: 'pipe' });
    execSync('git config user.email "bot@replit.com" 2>/dev/null || true', { stdio: 'pipe' });
    execSync('git init 2>/dev/null || true', { stdio: 'pipe' });
    
    // Set up remote with authentication if not already configured
    try {
      execSync('git remote get-url origin', { stdio: 'pipe' });
    } catch {
      if (process.env.GIT_URL) {
        console.log('🔧 Setting up GitHub remote...');
        execSync(`git remote add origin ${process.env.GIT_URL}`, { stdio: 'inherit' });
      } else {
        throw new Error('GIT_URL secret not configured');
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
      execSync(`git push ${process.env.GIT_URL} main`, { stdio: 'inherit' });
      console.log(`🚀 Analysis pushed to GitHub as ${filename}`);
    } catch {
      console.log('⚠️ Push failed - check your GIT_URL secret and repository permissions');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

pushAnalysisToGitHub();


const codeHealer = require('./utils/codeHealer');

// Test run of the CodeHealer
async function testHealer() {
    console.log('🔍 Running CodeHealer test...\n');
    
    const issues = await codeHealer.heal();
    
    console.log('Found issues:');
    issues.forEach(issue => {
        console.log('\n-------------------');
        console.log(`File: ${issue.file}`);
        console.log(`Type: ${issue.type}`);
        console.log(`Description: ${issue.description}`);
        console.log(`Suggested Fix: ${issue.fix}`);
        console.log(`Auto-fixable: ${issue.autoFixable}`);
    });
}

testHealer().catch(console.error);

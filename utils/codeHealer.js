
const { createClient } = require('@supabase/supabase-js');
const esprima = require('esprima');
const fs = require('fs');
const path = require('path');

class CodeHealer {
  constructor() {
    this.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    this.knownPatterns = {
      'undefinedCheck': /(!==\s*undefined)/,
      'consoleLog': /console\.log\(/,
      'uncaughtPromise': /\.then\(.*\)(?!\.catch)/
    };
  }

  async heal() {
    const issues = [];
    issues.push(...await this.analyzeCode());
    issues.push(...await this.checkDatabaseSchema());
    return this.suggestFixes(issues);
  }

  async analyzeCode(dir = '.') {
    const issues = [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const code = fs.readFileSync(filePath, 'utf8');
      
      try {
        const syntaxErrors = esprima.parseScript(code, { tolerant: true }).errors;
        if (syntaxErrors.length) {
          issues.push({
            type: 'syntax',
            file: filePath,
            errors: syntaxErrors
          });
        }
      } catch (error) {
        issues.push({
          type: 'error',
          file: filePath,
          error: error.message
        });
      }
    }
    return issues;
  }

  async checkDatabaseSchema() {
    const issues = [];
    const { data: tables, error } = await this.supabase
      .from('information_schema.columns')
      .select('*');
    
    if (error) return issues;

    tables?.forEach(column => {
      if (column.column_name.endsWith('_id') && !column.is_nullable) {
        issues.push({
          type: 'database',
          table: column.table_name,
          column: column.column_name,
          issue: 'Missing index on foreign key'
        });
      }
    });

    return issues;
  }

  async suggestFixes(issues) {
    return issues.map(issue => ({
      file: issue.file,
      type: issue.type,
      description: this.getDescription(issue),
      fix: this.getFix(issue),
      autoFixable: this.isAutoFixable(issue)
    }));
  }

  getDescription(issue) {
    const descriptions = {
      syntax: 'Syntax error in code',
      pattern: `Found potentially problematic pattern: ${issue.pattern}`,
      database: `Database issue: ${issue.issue}`,
      error: `Error analyzing file: ${issue.error}`
    };
    return descriptions[issue.type];
  }

  getFix(issue) {
    switch(issue.type) {
      case 'pattern':
        return this.getPatternFix(issue.pattern);
      case 'database':
        return `CREATE INDEX idx_${issue.column} ON ${issue.table} (${issue.column});`;
      default:
        return 'Manual review required';
    }
  }

  isAutoFixable(issue) {
    return ['pattern', 'database'].includes(issue.type);
  }

  getPatternFix(pattern) {
    const fixes = {
      'undefinedCheck': 'Use optional chaining (?.) instead',
      'consoleLog': 'Remove console.log in production',
      'uncaughtPromise': 'Add .catch() handler to promise'
    };
    return fixes[pattern];
  }
}

module.exports = CodeHealer;

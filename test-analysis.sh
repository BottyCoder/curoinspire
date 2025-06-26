
#!/bin/bash

# Test the project analysis endpoint
TOKEN="${ANALYSIS_TOKEN}"
URL="https://$(echo $REPL_SLUG)-$(echo $REPL_OWNER).replit.dev/api/project-analysis"

echo "🔍 Testing project analysis endpoint..."
echo "URL: $URL"

# Pull the analysis
curl -s -H "x-analysis-token: $TOKEN" "$URL" -o analysis.json

if [ $? -eq 0 ] && [ -s analysis.json ]; then
    echo "✅ Analysis downloaded successfully"
    
    # Show file count
    FILE_COUNT=$(jq -r '.files | length' analysis.json)
    echo "📁 Total files: $FILE_COUNT"
    
    # Show first 30 file paths
    echo -e "\n📂 First 30 file paths:"
    jq -r '.files[].path' analysis.json | head -n 30
    
    # Lines of code by extension
    echo -e "\n📊 Lines of code by extension:"
    jq -r '.files[] | "\(.path)\t\(.content|split("\n")|length)"' analysis.json \
      | awk -F'\t' '{ext=$1; sub(/.*\./,"",ext); loc[ext]+=$2} END{for(e in loc) print e,loc[e]}' \
      | sort -k2 -nr | head -10
    
    echo -e "\n💾 Analysis saved to analysis.json"
else
    echo "❌ Failed to download analysis"
    cat analysis.json 2>/dev/null || echo "No response received"
fi

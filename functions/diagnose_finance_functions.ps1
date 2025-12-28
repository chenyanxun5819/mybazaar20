# Finance Manager 函数诊断脚本
# 在 functions 目录下运行此脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Finance Manager 函数诊断工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查当前目录
Write-Host "[1/7] 检查当前目录..." -ForegroundColor Yellow
if (-not (Test-Path "package.json")) {
    Write-Host "❌ 错误：请在 functions 目录下运行此脚本" -ForegroundColor Red
    exit 1
}
Write-Host "✅ 当前目录正确" -ForegroundColor Green
Write-Host ""

# 2. 检查文件是否存在
Write-Host "[2/7] 检查 financeManagerFunctions.js 是否存在..." -ForegroundColor Yellow
if (Test-Path "financeManagerFunctions.js") {
    Write-Host "✅ financeManagerFunctions.js 存在" -ForegroundColor Green
    $fileSize = (Get-Item "financeManagerFunctions.js").Length
    Write-Host "   文件大小: $fileSize 字节" -ForegroundColor White
} else {
    Write-Host "❌ financeManagerFunctions.js 不存在！" -ForegroundColor Red
    Write-Host "   请确保文件在 functions 目录中" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# 3. 检查文件内容
Write-Host "[3/7] 检查文件内容..." -ForegroundColor Yellow
$content = Get-Content "financeManagerFunctions.js" -Raw

# 检查是否有 exports
if ($content -match "exports\.getFinanceStats") {
    Write-Host "✅ 找到 exports.getFinanceStats" -ForegroundColor Green
} else {
    Write-Host "❌ 没有找到 exports.getFinanceStats" -ForegroundColor Red
}

if ($content -match "exports\.confirmCashSubmission") {
    Write-Host "✅ 找到 exports.confirmCashSubmission" -ForegroundColor Green
} else {
    Write-Host "❌ 没有找到 exports.confirmCashSubmission" -ForegroundColor Red
}

# 检查是否使用了 regionalFunctions 或 onCall
if ($content -match "regionalFunctions") {
    Write-Host "✅ 使用 regionalFunctions (v1 API)" -ForegroundColor Green
} elseif ($content -match "onCall") {
    Write-Host "✅ 使用 onCall (v2 API)" -ForegroundColor Green
} else {
    Write-Host "❌ 未找到函数定义" -ForegroundColor Red
}
Write-Host ""

# 4. 检查语法错误
Write-Host "[4/7] 检查语法错误..." -ForegroundColor Yellow
try {
    $syntaxCheck = node -c "financeManagerFunctions.js" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ 语法检查通过" -ForegroundColor Green
    } else {
        Write-Host "❌ 语法错误：" -ForegroundColor Red
        Write-Host $syntaxCheck -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "⚠️  无法进行语法检查（Node.js 可能未安装）" -ForegroundColor Yellow
}
Write-Host ""

# 5. 检查 index.js 的导入
Write-Host "[5/7] 检查 index.js 的导入..." -ForegroundColor Yellow
$indexContent = Get-Content "index.js" -Raw

if ($indexContent -match "require\(['`"]\.\/financeManagerFunctions['`"]\)") {
    Write-Host "✅ index.js 中找到 require('./financeManagerFunctions')" -ForegroundColor Green
} else {
    Write-Host "❌ index.js 中没有找到正确的 require 语句" -ForegroundColor Red
}

if ($indexContent -match "exports\.getFinanceStats.*financeManagerFunctions") {
    Write-Host "✅ index.js 中找到 exports.getFinanceStats" -ForegroundColor Green
} else {
    Write-Host "❌ index.js 中没有找到 exports.getFinanceStats" -ForegroundColor Red
}

if ($indexContent -match "exports\.confirmCashSubmission.*financeManagerFunctions") {
    Write-Host "✅ index.js 中找到 exports.confirmCashSubmission" -ForegroundColor Green
} else {
    Write-Host "❌ index.js 中没有找到 exports.confirmCashSubmission" -ForegroundColor Red
}
Write-Host ""

# 6. 尝试加载模块
Write-Host "[6/7] 尝试加载模块..." -ForegroundColor Yellow
try {
    $loadTest = node -e "try { const fn = require('./financeManagerFunctions'); console.log('SUCCESS:', Object.keys(fn)); } catch(e) { console.log('ERROR:', e.message); process.exit(1); }" 2>&1
    
    if ($loadTest -match "SUCCESS") {
        Write-Host "✅ 模块加载成功" -ForegroundColor Green
        Write-Host "   导出的函数: $($loadTest -replace 'SUCCESS: ', '')" -ForegroundColor White
    } else {
        Write-Host "❌ 模块加载失败" -ForegroundColor Red
        Write-Host "   错误: $loadTest" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 无法测试模块加载" -ForegroundColor Red
    Write-Host "   错误: $_" -ForegroundColor Red
}
Write-Host ""

# 7. 尝试加载 index.js
Write-Host "[7/7] 尝试加载 index.js..." -ForegroundColor Yellow
try {
    $indexLoadTest = node -e "try { const fn = require('./index'); const fns = Object.keys(fn); console.log('Total functions:', fns.length); const finance = fns.filter(f => f.includes('Finance') || f.includes('finance')); console.log('Finance functions:', finance.join(', ')); } catch(e) { console.log('ERROR:', e.message); process.exit(1); }" 2>&1
    
    if ($indexLoadTest -match "ERROR") {
        Write-Host "❌ index.js 加载失败" -ForegroundColor Red
        Write-Host "   错误: $indexLoadTest" -ForegroundColor Red
    } else {
        Write-Host "✅ index.js 加载成功" -ForegroundColor Green
        Write-Host $indexLoadTest -ForegroundColor White
    }
} catch {
    Write-Host "❌ 无法测试 index.js 加载" -ForegroundColor Red
}
Write-Host ""

# 总结
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "诊断完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "如果上面显示任何 ❌，请截图并提供完整输出" -ForegroundColor Yellow
Write-Host ""

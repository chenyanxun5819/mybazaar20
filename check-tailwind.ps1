# check-tailwind.ps1
# 檢查專案中是否有 Tailwind CSS

Write-Host "==========================================" -ForegroundColor Blue
Write-Host "檢查 MyBazaar 專案中的 Tailwind CSS" -ForegroundColor Blue
Write-Host "==========================================" -ForegroundColor Blue
Write-Host ""

# 檢查是否在專案根目錄
Write-Host "1. 檢查 package.json 中的 Tailwind 依賴..." -ForegroundColor Yellow
Write-Host "----------------------------------------"

if (Test-Path "package.json") {
    Write-Host "✓ package.json 存在" -ForegroundColor Green
    
    $packageJson = Get-Content "package.json" -Raw
    
    # 檢查 dependencies 和 devDependencies
    if ($packageJson -match "tailwindcss") {
        Write-Host "❌ 發現 tailwindcss 在 package.json" -ForegroundColor Red
        $packageJson | Select-String "tailwindcss" | ForEach-Object { 
            Write-Host "   $_" -ForegroundColor Red 
        }
    } else {
        Write-Host "✓ package.json 中沒有 tailwindcss" -ForegroundColor Green
    }
    
    # 檢查相關套件
    if ($packageJson -match "autoprefixer|postcss") {
        Write-Host "⚠️  發現 Tailwind 相關套件：" -ForegroundColor Yellow
        $packageJson | Select-String -Pattern "autoprefixer|postcss" | ForEach-Object { 
            Write-Host "   $_" -ForegroundColor Yellow 
        }
    }
} else {
    Write-Host "❌ 找不到 package.json" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. 檢查 Tailwind 配置文件..." -ForegroundColor Yellow
Write-Host "----------------------------------------"

if (Test-Path "tailwind.config.js") {
    Write-Host "❌ 發現 tailwind.config.js" -ForegroundColor Red
} elseif (Test-Path "tailwind.config.cjs") {
    Write-Host "❌ 發現 tailwind.config.cjs" -ForegroundColor Red
} else {
    Write-Host "✓ 沒有 Tailwind 配置文件" -ForegroundColor Green
}

Write-Host ""
Write-Host "3. 檢查 PostCSS 配置..." -ForegroundColor Yellow
Write-Host "----------------------------------------"

if (Test-Path "postcss.config.js") {
    Write-Host "⚠️  發現 postcss.config.js" -ForegroundColor Yellow
    $postcssContent = Get-Content "postcss.config.js" -Raw
    if ($postcssContent -match "tailwindcss") {
        Write-Host "   └─ 包含 tailwindcss 配置" -ForegroundColor Yellow
    }
} elseif (Test-Path "postcss.config.cjs") {
    Write-Host "⚠️  發現 postcss.config.cjs" -ForegroundColor Yellow
} else {
    Write-Host "✓ 沒有 PostCSS 配置文件" -ForegroundColor Green
}

Write-Host ""
Write-Host "4. 檢查 CSS 文件中的 Tailwind imports..." -ForegroundColor Yellow
Write-Host "----------------------------------------"

if (Test-Path "src") {
    $tailwindImports = Get-ChildItem -Path "src" -Include "*.css","*.scss" -Recurse -ErrorAction SilentlyContinue | 
        Select-String -Pattern "@tailwind|tailwindcss" -ErrorAction SilentlyContinue
    
    if ($tailwindImports) {
        Write-Host "❌ 發現以下文件包含 Tailwind imports：" -ForegroundColor Red
        $tailwindImports | ForEach-Object { 
            Write-Host "   $($_.Path)" -ForegroundColor Red 
        }
    } else {
        Write-Host "✓ 沒有發現 CSS 文件包含 Tailwind imports" -ForegroundColor Green
    }
} else {
    Write-Host "⚠️  找不到 src 目錄" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "5. 檢查 index.css 或 main.css..." -ForegroundColor Yellow
Write-Host "----------------------------------------"

if (Test-Path "src/index.css") {
    $indexCss = Get-Content "src/index.css" -Raw
    if ($indexCss -match "@tailwind") {
        Write-Host "❌ src/index.css 包含 Tailwind directives" -ForegroundColor Red
        $indexCss | Select-String "@tailwind" | ForEach-Object { 
            Write-Host "   $_" -ForegroundColor Red 
        }
    } else {
        Write-Host "✓ src/index.css 沒有 Tailwind directives" -ForegroundColor Green
    }
} elseif (Test-Path "src/main.css") {
    $mainCss = Get-Content "src/main.css" -Raw
    if ($mainCss -match "@tailwind") {
        Write-Host "❌ src/main.css 包含 Tailwind directives" -ForegroundColor Red
    } else {
        Write-Host "✓ src/main.css 沒有 Tailwind directives" -ForegroundColor Green
    }
} else {
    Write-Host "⚠️  找不到主要 CSS 文件" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Blue
Write-Host "檢查完成！" -ForegroundColor Blue
Write-Host "==========================================" -ForegroundColor Blue

console.log("[DHI] main.js loaded");

// ============================================================
// 🧩 全局异常处理
// ============================================================

function setupGlobalErrorHandling() {
    window.onerror = function(message, source, lineno, colno, error) {
        console.error('【全局错误】', message, source, lineno, colno, error);
        toast('⚠️ 发生未知错误，请按 F12 查看控制台详情');
        try {
            const log = JSON.parse(localStorage.getItem('errorLog') || '[]');
            log.push({
                time: new Date().toISOString(),
                message: String(message),
                source: source || '',
                lineno: lineno || 0,
                colno: colno || 0,
                stack: error ? error.stack : ''
            });
            if (log.length > 50) log.shift();
            localStorage.setItem('errorLog', JSON.stringify(log));
        } catch (e) { /* 忽略日志写入错误 */ }
        return true;
    };

    window.onunhandledrejection = function(event) {
        console.error('【未处理的Promise拒绝】', event.reason);
        toast('⚠️ 发生异步错误，请按 F12 查看控制台详情');
        try {
            const log = JSON.parse(localStorage.getItem('errorLog') || '[]');
            log.push({
                time: new Date().toISOString(),
                type: 'unhandledrejection',
                reason: String(event.reason)
            });
            if (log.length > 50) log.shift();
            localStorage.setItem('errorLog', JSON.stringify(log));
        } catch (e) { /* 忽略 */ }
        event.preventDefault();
    };

    window.addEventListener('error', function(e) {
        if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT')) {
            console.warn('资源加载失败:', e.target.src || e.target.href);
            return;
        }
        if (!e.message) return;
        toast('⚠️ 页面发生错误，请查看控制台');
    }, true);
}

// ============================================================
// 📌 备份提醒
// ============================================================

let backupCheckDone = false;

function checkBackupReminder() {
    if (backupCheckDone) return;
    backupCheckDone = true;

    const hasSeenWelcome = localStorage.getItem('hasSeenWelcome');
    if (!hasSeenWelcome) {
        // 第一次启动：弹模态框
        showModal({
            title: '欢迎使用 DHI 分类学笔记！',
            content: `
                <p style="font-size:1rem;line-height:1.8;">
                    数据保存在本地浏览器中，<strong>请定期导出 JSON 备份</strong>，以防缓存清理导致数据丢失。
                </p>
                <p style="margin-top:12px;color:#666;">
                    建议每次重要更新后点击「导出JSON」保存。
                </p>
                <div style="margin-top:20px;text-align:center;">
                    <button class="btn-save" onclick="closeModal();" style="font-size:1rem;padding:8px 32px;">知道了</button>
                </div>
            `,
            hideFooter: true,
            allowOverlayClose: true
        });
        localStorage.setItem('hasSeenWelcome', 'true');
        localStorage.setItem('lastBackupCheck', Date.now().toString());
        return;
    }

    // 非首次：检查是否超过7天未备份
    const lastExport = localStorage.getItem('lastExportTime');
    if (lastExport) {
        const days = (Date.now() - parseInt(lastExport)) / (1000 * 60 * 60 * 24);
        if (days > 7) {
            const toastEl = document.getElementById('toast');
            toastEl.classList.add('warning');
            toast('⚠️ 已超过7天未备份数据，建议点击「导出JSON」保存。');
            setTimeout(() => {
                toastEl.classList.remove('warning');
            }, 4000);
        }
    } else {
        // 从未导出过，温和提醒
        const lastCheck = localStorage.getItem('lastBackupCheck');
        if (!lastCheck || (Date.now() - parseInt(lastCheck)) > 24 * 60 * 60 * 1000) {
            toast('💡 提示：点击「导出JSON」可备份所有数据（含图片）');
            localStorage.setItem('lastBackupCheck', Date.now().toString());
        }
    }
}

// ============================================================
// 🚀 初始化
// ============================================================

// ----- 下拉菜单：单击切换，点击外部关闭 -----
function setupDropdowns() {
    const dropdowns = document.querySelectorAll('.toolbar .dropdown');
    const dropdownButtons = document.querySelectorAll('.toolbar .dropbtn');

    // 单击按钮切换下拉
    dropdownButtons.forEach((btn, index) => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();  // 阻止冒泡，避免立即被 document 关闭
            const parent = this.closest('.dropdown');
            if (!parent) return;
            // 如果当前已打开，关闭它；否则先关闭所有再打开它
            const isOpen = parent.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                parent.classList.add('open');
            }
        });
    });

    // 点击下拉项时，关闭所有下拉（选项会执行自己的 onclick）
    document.querySelectorAll('.toolbar .dropdown-content a, .toolbar .dropdown-content button').forEach(item => {
        item.addEventListener('click', function() {
            closeAllDropdowns();
        });
    });

    // 点击页面其他位置关闭所有下拉
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.toolbar .dropdown')) {
            closeAllDropdowns();
        }
    });

    function closeAllDropdowns() {
        dropdowns.forEach(d => d.classList.remove('open'));
    }
}

function initDHI() {
    setupGlobalErrorHandling();

    if (!loadData()) {
        Store.setTreeData(deepClone(DEFAULT_DATA));
        Store.getTreeData().version = CURRENT_VERSION;
        Store.setSelectedNode(
            Store.getTreeData()
        );
        Store.setIdCounter(1000);
        saveData();
    } else {
        // 确保数据完整
        const data = Store.getTreeData();
        if (!data || !data.id) {
            Store.setTreeData(deepClone(DEFAULT_DATA));
            Store.getTreeData().version = CURRENT_VERSION;
            saveData();
        } else {
            ensureAllFields(data);      // 传入 data
            data.version = CURRENT_VERSION;
            saveData();
        }
    }

    renderTree();
    applyFontPreference();
    setupSearch();
    setupLightbox();
    setupSidebarResizer();
    setupDropdowns();
    Comparison.init();          // 提前初始化，恢复模式
    showTaxonContent(Store.getTreeData());
    updateComparisonEntry();

    // 卡片点击事件委托（用于快速选择模式）
    document.getElementById('mainContentWrap').addEventListener('click', function(e) {
        const card = e.target.closest('.card');
        if (!card) return;
        const nodeId = card.dataset.nodeId;
        if (!nodeId) return;
        const node = findNodeById(Store.getTreeData(), nodeId);
        if (!node) return;

        // 快速选择模式下的终端节点处理
        if (InteractionState.mode === 'quickSelect') {
            if (isTerminalNode(node)) {
                toggleComparisonNode(node, null);
                updateQuickSelectUI();
                return;
            }
            // 非终端节点则继续执行普通行为（跳转或详情）
            // 不 return，继续执行下方普通逻辑
        }

        // 普通模式点击行为（或快速选择模式下的非终端节点）
        if (node.type === 'content') {
            showContentDetail(node);
        } else if (isTerminalNode(node) || isSpeciesNode(node)) {
            showSpeciesDetail(node);
        } else {
            jumpToNode(node);
        }
    });

    // 恢复卡片尺寸 —— 从像素值反推滑块位置
    let savedPx = localStorage.getItem('cardSize');
    let percent = 50; // 默认
    if (savedPx) {
        const px = parseInt(savedPx, 10);
        if (!isNaN(px) && px >= 120 && px <= 400) {
            percent = Math.round((px - 120) / (400 - 120) * 100);
        } else {
            // 兼容旧版 small/medium/large
            if (savedPx === 'small') percent = 15;
            else if (savedPx === 'medium') percent = 50;
            else if (savedPx === 'large') percent = 80;
        }
    } else {
        // 兼容旧版 cardSizePercent（如果存在）
        const oldPercent = localStorage.getItem('cardSizePercent');
        if (oldPercent) {
            const p = parseInt(oldPercent, 10);
            if (!isNaN(p) && p >= 0 && p <= 100) percent = p;
            localStorage.removeItem('cardSizePercent');
        }
    }
    percent = Math.min(100, Math.max(0, percent));
    applyCardSize(percent);

    // 同步更新滑块位置（如果当前有滑块）
    const slider = document.querySelector('.size-control input[type="range"]');
    if (slider) slider.value = percent;

    if (localStorage.getItem('editMode') === 'true') {
        setTimeout(() => { if (!window.UIState.isEditMode) toggleEditMode(); }, 100);
    }

    // ---- 备份提醒（首次弹模态框，后续 Toast） ----
    setTimeout(checkBackupReminder, 600);

    document.getElementById('modalCloseBtn').onclick = closeModal;
    document.getElementById('speciesModalClose').onclick = function() {
        document.getElementById('speciesModal').classList.remove('active');
    };
    document.getElementById('speciesModal').addEventListener('click', function(e) {
        if (e.target === this) this.classList.remove('active');
    });

    // 绑定 Excel 导入按钮
    document.getElementById('excelImportBtn').addEventListener('click', function(e) {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.onchange = async function(e) {
            if (this.files.length === 0) return;
            const file = this.files[0];
            try {
                await importExcelFromFile(file);
            } catch (err) {
                toast('❌ Excel 导入失败: ' + err.message);
                console.error(err);
            }
            this.value = ''; // 重置
        };
        input.click();
    });

    document.addEventListener('keydown', function(e) {

        // Ctrl/Cmd + E
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            toggleEditMode();
            return;
        }

        // ===== Ctrl+Shift+F 切换字体 =====
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            toggleFont();
            return;
        }

        if (window.UIState.lightboxState.isOpen) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prevImage();
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                nextImage();
                return;
            }
        }

        if (e.key !== 'Escape') return;

        // Lightbox（最高层）
        const lightbox = document.getElementById('lightbox');
        if (lightbox?.classList.contains('active')) {
            e.preventDefault();
            closeLightbox();
            return;
        }

        // Generic Modal（次高层）
        const genericModal = document.getElementById('genericModal');
        if (genericModal?.classList.contains('active')) {
            e.preventDefault();
            tryCloseModal(genericModal);   // 传入参数，明确关闭对象
            return;
        }

        // Species Modal（底层）
        const speciesModal = document.getElementById('speciesModal');
        if (speciesModal?.classList.contains('active')) {
            e.preventDefault();
            speciesModal.classList.remove('active');
            return;
        }
    });

    const clearBtn = document.getElementById('quickSelectClearBtn');
    const compareBtn = document.getElementById('quickSelectCompareBtn');
    const exitBtn = document.getElementById('quickSelectExitBtn');

    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            Comparison.clear();
            updateQuickSelectUI();
        });
    }
    if (compareBtn) {
        compareBtn.addEventListener('click', function() {
            if (Comparison.count() === 0) {
                toast('请至少选择一个分类单元');
                return;
            }
            // 不退出快速选择模式，只打开 Overlay
            Comparison.open(Comparison.getMode());
            updateComparisonEntry();
            // 隐藏 Banner（因为 Overlay 会覆盖）
            const banner = document.getElementById('quickSelectBanner');
            if (banner) banner.style.display = 'none';
        });
    }
    if (exitBtn) {
        exitBtn.addEventListener('click', function() {
            exitQuickSelect();
        });
    }

    console.info("DHI Taxonomic Notebook v1.3.0 demo");

    // Comparison Overlay 内部模式切换
    const parallelBtn = document.getElementById('comparisonModeParallel');
    const tableBtn = document.getElementById('comparisonModeTable');
    if (parallelBtn) {
        parallelBtn.addEventListener('click', function() {
            setComparisonMode('parallel');
        });
    }
    if (tableBtn) {
        tableBtn.addEventListener('click', function() {
            setComparisonMode('table');
        });
    }
}

document.addEventListener('DOMContentLoaded', initDHI);

// 导出进度模态框
function showExportProgressModal() {
    const modal = document.getElementById('genericModal');
    const body = document.getElementById('modalBody');
    body.innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
            <h3>正在导出 Markdown ZIP</h3>
            <p id="exportProgressText" style="color:#666;">正在准备...</p>
            <div style="margin-top:20px;width:100%;background:#eee;border-radius:4px;overflow:hidden;">
                <div id="exportProgressBar" style="width:0%;height:6px;background:#4caf50;transition:width 0.3s;"></div>
            </div>
        </div>
    `;
    // 禁用关闭按钮和遮罩点击
    document.getElementById('modalCloseBtn').style.display = 'none';
    modal.classList.add('active');
    // 保存更新函数
    window._exportProgress = {
        setText: (text) => {
            const el = document.getElementById('exportProgressText');
            if (el) el.textContent = text;
        },
        setProgress: (percent) => {
            const bar = document.getElementById('exportProgressBar');
            if (bar) bar.style.width = Math.min(100, Math.max(0, percent)) + '%';
        },
        close: () => {
            document.getElementById('modalCloseBtn').style.display = '';
            closeModal();
        }
    };
}

// 导出markdown
async function exportMarkdownPackageFromUI() {
    const selectedNode = Store.getSelectedNode();
    if (!selectedNode) {
        toast('⚠️ 请先选择一个分类群');
        return;
    }

    // 显示进度模态框
    showExportProgressModal();
    const progress = window._exportProgress;

    try {
        // 🆕 传入 onProgress 回调
        const packageResult = await exportMarkdownPackage({
            mode: 'subtree',
            targetNodeId: selectedNode.id,
            onProgress: (update) => {
                const { stage, value } = update;

                switch (stage) {
                    case 'root_resolved':
                        progress.setText('📂 正在解析导出根节点...');
                        progress.setProgress(2);
                        break;

                    case 'markdown_rendered':
                        progress.setText('📝 正在生成 Markdown 正文...');
                        progress.setProgress(10);
                        break;

                    case 'images_collected':
                        const total = value.total || 0;
                        progress.setText(`🖼️ 找到 ${total} 张图片，准备读取...`);
                        progress.setProgress(12);
                        break;

                    case 'images_resolving':
                        const { current, total: totalImgs, percent } = value;
                        progress.setText(`🖼️ 正在读取图片 ${current}/${totalImgs}...`);
                        // percent 已经包含了 10%~70% 的映射
                        progress.setProgress(percent);
                        break;

                    case 'paths_rewritten':
                        progress.setText('✏️ 正在更新图片路径引用...');
                        progress.setProgress(75);
                        break;

                    case 'zipping':
                        const zipPercent = value.percent || 80;
                        progress.setText(`🗜️ 正在压缩 ZIP 文件 (${Math.round(zipPercent)}%)...`);
                        progress.setProgress(zipPercent);
                        break;

                    case 'done':
                        progress.setText('✅ 导出完成！');
                        progress.setProgress(100);
                        break;

                    default:
                        break;
                }
            }
        });

        // 校验并下载
        if (!packageResult || !(packageResult.blob instanceof Blob)) {
            throw new Error('Markdown ZIP export returned no Blob.');
        }

        const safeName = String(selectedNode.name || 'DHI-Export')
            .trim()
            .replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${safeName}.zip`;

        downloadBlob(packageResult.blob, fileName);

        // 关闭模态框（延迟一下让用户看到 100%）
        setTimeout(() => {
            progress.close();
        }, 600);

        if (Array.isArray(packageResult.warnings) && packageResult.warnings.length > 0) {
            toast(`✅ Markdown 已导出，但有 ${packageResult.warnings.length} 个警告`);
            console.warn('[DHI] Markdown export warnings:', packageResult.warnings);
        } else {
            toast('✅ Markdown ZIP 已导出');
        }

    } catch (error) {
        console.error('[DHI] Markdown ZIP export failed:', error);
        progress.setText('❌ 导出失败：' + error.message);
        progress.setProgress(0);
        document.getElementById('modalCloseBtn').style.display = '';
        toast('❌ Markdown ZIP 导出失败，请查看控制台');
    }
}

// ============================================================
// DHI Taxonomic Notebook — Comparison Mode
// Phase 2A: Content Rendering (Reusing Species Detail Renderer)
// ============================================================
//
// 本模块管理 Comparison View 的状态与渲染。
// 复用 buildSpeciesDetailHTML / mountSpeciesDetailContent 实现物种详情展示。
// 不修改 Store / selectedNode / treeData / taxonProfiles。
//
// ============================================================

console.log('[DHI] comparison.js loaded');

const Comparison = (() => {
    // ---------- 私有状态 ----------
    const MAX_NODES = 4;
    let _nodeIds = [];          // 存储 node.id 字符串
    let _isOpen = false;
    let _container = null;      // #comparisonView
    let _body = null;           // #comparisonViewBody
    let _closeBtn = null;
    let _status = null;
    let _eventListenerInitialized = false;
    let _mode = 'parallel';   // 'parallel' | 'table'

    // ---------- 内部工具 ----------
    const isValidId = (id) => {
        return typeof id === 'string' && id.trim().length > 0;
    };

    // ---------- 渲染函数 ----------
    function renderComparisonEmptyState(message) {
        if (!_body) return;
        _body.innerHTML = `
            <div class="comparison-view__empty">
                <span>∅</span>
                ${message || '物种对比<br><small style="color:#bbb;">当前暂无对比物种</small>'}
            </div>
        `;
    }

    function renderComparisonView() {
        if (!_body) {
            console.warn('[Comparison] Cannot render: body not found');
            return;
        }

        // 1. 清理旧内容（释放 Blob URLs）
        cleanupBlobURLs(_body);
        _body.innerHTML = '';
        updateComparisonStatus();

        // 2. 获取当前对比列表
        const nodeIds = Comparison.getNodeIds();

        // 3. 空状态
        if (nodeIds.length === 0) {
            renderComparisonEmptyState('物种对比<br><small style="color:#bbb;">当前暂无对比物种</small>');
            return;
        }

        // 4. 查找有效节点（过滤已删除的 ID）
        const tree = Store.getTreeData();
        const validNodes = nodeIds
            .map(id => findNodeById(tree, id))
            .filter(Boolean);

        // 5. 所有 ID 均无效
        if (validNodes.length === 0) {
            renderComparisonEmptyState('没有可显示的对比物种<br><small style="color:#bbb;">所选物种可能已被删除</small>');
            return;
        }

        // 6. 创建 panes 容器
        const panesWrapper = document.createElement('div');
        panesWrapper.className = 'comparison-view__panes';
        panesWrapper.style.setProperty('--pane-count', validNodes.length);

        // 7. 为每个有效节点创建一个 pane
        validNodes.forEach(node => {
            const pane = document.createElement('div');
            pane.className = 'comparison-view__pane';

            // 生成 HTML（Comparison 中禁用编辑和面包屑）
            const html = buildSpeciesDetailHTML(node, {
                showEditButton: false,
                showBreadcrumb: false,
                showAlbumToggle: true,      // 允许相册展开/收起，保持体验一致
                showComparisonToggle: false,
                showEmptyFields: true,      // 新增
                addSectionData: true,        // 新增
                alwaysShowToggle: true
            });

            // 挂载内容
            const mountOptions = {
                onBreadcrumbClick: null,
                onPhotoClick: modalPhotoClickHandler,
                lazyLoadImages: true,
                setupCollapse: true
            };

            // 表格模式：启用折叠同步对齐
            if (_mode === 'table') {
                mountOptions.onToggle = function() {
                    // 清除所有 section 的 min-height
                    const panes = panesWrapper.querySelectorAll('.comparison-view__pane');
                    const sectionKeys = ['taxonomy', 'ecology', 'morphology', 'references'];
                    for (const key of sectionKeys) {
                        for (const pane of panes) {
                            const sec = pane.querySelector(`.detail-section[data-section="${key}"]`);
                            if (sec) sec.style.minHeight = '';
                        }
                    }
                    // 重新对齐
                    setTimeout(() => {
                        alignComparisonSections(panesWrapper);
                        const updatedPanes = panesWrapper.querySelectorAll('.comparison-view__pane');
                        alignMorphologySubsections(updatedPanes);
                    }, 200);
                };
            }
            mountSpeciesDetailContent(pane, html, mountOptions);

            const header = pane.querySelector('.modal-header');
            const body = pane.querySelector('.modal-body');
            const oldFooter = pane.querySelector('.modal-footer');
            if (header && body) {
                // 创建滚动容器
                const scrollContainer = document.createElement('div');
                scrollContainer.className = 'pane-scroll';
                // 移动 header 和 body 到滚动容器
                scrollContainer.appendChild(header);
                scrollContainer.appendChild(body);
                // 插入到 pane 顶部（在自定义 footer 之前）
                const footer = pane.querySelector('.comparison-pane-footer');
                if (footer) {
                    pane.insertBefore(scrollContainer, footer);
                } else {
                    pane.appendChild(scrollContainer);
                }
                // 隐藏原来的 modal-footer（如果有）
                if (oldFooter) oldFooter.style.display = 'none';
            }

            const paneFooter = document.createElement('div');
            paneFooter.className = 'comparison-pane-footer';
            paneFooter.style.cssText = `
                display: flex;
                justify-content: flex-end;
                padding: 10px 16px 14px;
                border-top: 1px solid #eaeef2;
                background: #fafbfc;
                border-radius: 0 0 8px 8px;
            `;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'comparison-remove-btn';
            removeBtn.dataset.comparisonRemove = node.id;
            removeBtn.textContent = '✕ 移出对比';
            paneFooter.appendChild(removeBtn);

            pane.appendChild(paneFooter);
            panesWrapper.appendChild(pane);
        });

        _body.appendChild(panesWrapper);

        if (_mode === 'table') {
            setTimeout(() => {
                alignComparisonSections(panesWrapper);
                const panes = panesWrapper.querySelectorAll('.comparison-view__pane');
                alignMorphologySubsections(panes);
            }, 300);
        }

        // 更新状态
        updateComparisonStatus();
    }

    function alignComparisonSections(panesWrapper) {
        if (!panesWrapper) return;
        const panes = panesWrapper.querySelectorAll('.comparison-view__pane');
        if (panes.length < 2) return;

        // 需要对齐的 section 类型列表
        const sectionKeys = ['taxonomy', 'ecology', 'morphology', 'references', 'album'];

        // 第一步：清除所有 section 的 min-height（重置）
        for (const key of sectionKeys) {
            for (const pane of panes) {
                const sec = pane.querySelector(`.detail-section[data-section="${key}"]`);
                if (sec) {
                    sec.style.minHeight = ''; // 重置为 auto
                }
            }
        }

        // 第二步：重新计算并设置 min-height
        for (const key of sectionKeys) {
            const sections = [];
            for (const pane of panes) {
                const sec = pane.querySelector(`.detail-section[data-section="${key}"]`);
                if (sec) sections.push(sec);
            }
            if (sections.length < 2) continue;

            // 计算当前实际高度（此时 min-height 已清除）
            let maxHeight = 0;
            for (const sec of sections) {
                // 使用 scrollHeight 或 offsetHeight，注意 padding/border
                const height = sec.offsetHeight;
                if (height > maxHeight) {
                    maxHeight = height;
                }
            }
            if (maxHeight > 0) {
                for (const sec of sections) {
                    sec.style.minHeight = maxHeight + 'px';
                }
            }
        }
    }

    function alignMorphologySubsections(panes) {
        const subKeys = ['diagnosis', 'description', 'etymology', 'discussion'];

        // 1. 处理子元素（鉴定要点、物种描述等）
        for (const subKey of subKeys) {
            const elements = [];
            for (const pane of panes) {
                const el = pane.querySelector(`.morph-subsection[data-subsection="${subKey}"]`);
                if (el) elements.push(el);
            }
            if (elements.length < 2) continue;

            // 清除 min-height
            for (const el of elements) {
                el.style.minHeight = '';
            }
            // 强制回流
            void elements[0].offsetHeight;

            let maxHeight = 0;
            for (const el of elements) {
                const h = el.offsetHeight;
                if (h > maxHeight) maxHeight = h;
            }
            if (maxHeight > 0) {
                for (const el of elements) {
                    el.style.minHeight = maxHeight + 'px';
                }
            }
        }

        // 2. 对齐整个 morphology section（确保大标题对齐）
        const morphSections = [];
        for (const pane of panes) {
            const sec = pane.querySelector('.detail-section[data-section="morphology"]');
            if (sec) morphSections.push(sec);
        }
        if (morphSections.length < 2) return;

        // 清除之前可能设置的 min-height（但应该已被清除）
        for (const sec of morphSections) {
            sec.style.minHeight = '';
        }
        // 强制回流
        void morphSections[0].offsetHeight;

        let maxSectionHeight = 0;
        for (const sec of morphSections) {
            const h = sec.offsetHeight;
            if (h > maxSectionHeight) maxSectionHeight = h;
        }
        if (maxSectionHeight > 0) {
            for (const sec of morphSections) {
                sec.style.minHeight = maxSectionHeight + 'px';
            }
        }
    }

    function updateComparisonStatus() {
        if (!_status) return;
        _status.textContent = `已选择 ${Comparison.count()} / ${Comparison.getMaxNodes()} 个物种`;
    }

    // ---------- 公开 API ----------
    return {

        // ---- Phase 1A: State Management ----
        addNode(nodeId) {
            if (!isValidId(nodeId)) {
                console.warn('[Comparison] addNode: invalid id', nodeId);
                return false;
            }
            if (_nodeIds.includes(nodeId)) {
                return false;
            }
            if (_nodeIds.length >= MAX_NODES) {
                console.warn('[Comparison] addNode: maximum nodes reached', MAX_NODES);
                return false;
            }
            _nodeIds.push(nodeId);
            return true;
        },

        removeNode(nodeId) {
            if (!isValidId(nodeId)) return false;
            const index = _nodeIds.indexOf(nodeId);
            if (index === -1) return false;
            _nodeIds.splice(index, 1);
            return true;
        },

        hasNode(nodeId) {
            if (!isValidId(nodeId)) return false;
            return _nodeIds.includes(nodeId);
        },

        getNodeIds() {
            return [..._nodeIds];
        },

        count() {
            return _nodeIds.length;
        },

        isFull() {
            return _nodeIds.length >= MAX_NODES;
        },

        clear() {
            _nodeIds = [];
        },

        getMaxNodes() {
            return MAX_NODES;
        },

        // ---- Phase 1B: UI Shell Lifecycle ----
        init() {
            _container = document.getElementById('comparisonView');
            if (!_container) {
                console.warn('[Comparison] View container #comparisonView not found');
                return false;
            }
            _body = document.getElementById('comparisonViewBody');
            _closeBtn = document.getElementById('comparisonViewClose');
            _status = document.getElementById('comparisonViewStatus');

            if (_closeBtn) {
                _closeBtn.addEventListener('click', () => {
                    Comparison.close();
                    if (typeof updateComparisonEntry === 'function') {
                        updateComparisonEntry();
                    }
                });
            } else {
                console.warn('[Comparison] Close button #comparisonViewClose not found');
            }

            if (!_status) {   // ← 新增：可选警告
                console.warn('[Comparison] Status element #comparisonViewStatus not found');
            }

            if (_body && !_eventListenerInitialized) {
                _body.addEventListener('click', function(e) {
                    const btn = e.target.closest('[data-comparison-remove]');
                    if (!btn) return;
                    e.stopPropagation();

                    const nodeId = btn.dataset.comparisonRemove;
                    if (!nodeId) return;

                    // 调用 Comparison.removeNode
                    const removed = Comparison.removeNode(nodeId);
                    if (removed) {
                        // 刷新视图
                        renderComparisonView();
                        // 注意：renderComparisonView 内部会调用 updateComparisonStatus()
                        // 按钮文字在 Species Modal 中的更新由 toggleComparisonNode 负责
                        // 这里不需要额外操作
                    }
                });
                _eventListenerInitialized = true;
            }
            
            _container.hidden = true;
            // 恢复模式偏好
            const savedMode = localStorage.getItem('comparisonMode');
            if (savedMode === 'parallel' || savedMode === 'table') {
                _mode = savedMode;
            }
            return true;
        },

        open(mode) {
            if (!_container) {
                console.warn('[Comparison] Cannot open: not initialized');
                return false;
            }
            _mode = mode || 'parallel';
            _isOpen = true;
            _container.hidden = false;
            _container.dataset.mode = _mode;
            renderComparisonView();
            // ---- 新增 ----
            if (typeof window.updateComparisonModeUI === 'function') {
                window.updateComparisonModeUI();
            }
            return true;
        },

        close() {
            if (!_container) {
                return false;
            }
            // 释放 Comparison View 内所有图片的 Blob URL
            if (_body) {
                cleanupBlobURLs(_body);
            }
            _isOpen = false;
            _container.hidden = true;
            delete _container.dataset.mode;
            
            // ---- 新增：如果当前是快速选择模式，恢复 Banner ----
            if (typeof InteractionState !== 'undefined' && InteractionState.mode === 'quickSelect') {
                const banner = document.getElementById('quickSelectBanner');
                if (banner) banner.style.display = 'flex';
                if (typeof updateQuickSelectUI === 'function') {
                    updateQuickSelectUI();
                }
            }
            
            if (typeof updateComparisonEntry === 'function') {
                updateComparisonEntry();
            }
            return true;
        },

        isOpen() {
            return _isOpen;
        },

        // ---- Phase 2A: 额外辅助（便于外部刷新） ----
        refresh() {
            if (_isOpen) {
                renderComparisonView();
            }
        },
        // ---- 模式管理 ----
        setMode(mode) {
            if (mode === 'parallel' || mode === 'table') {
                _mode = mode;
                localStorage.setItem('comparisonMode', mode);
                if (_isOpen && _container) {
                    _container.dataset.mode = mode;
                    renderComparisonView();
                    if (typeof window.updateComparisonModeUI === 'function') {
                        window.updateComparisonModeUI();
                    }
                }
            }
        },
        getMode() {
            return _mode;
        },
    };
})();
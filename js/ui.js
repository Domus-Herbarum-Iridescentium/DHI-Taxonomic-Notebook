console.log("[DHI] ui.js loaded");

const UIState = {
    allNodes: [],
    isEditMode: false,
    sortableInstances: [],
    treeSortableInstances: [],
    highlightTimer: null,
    toastTimer: null,
    lightboxState: {
        images: [],
        currentIndex: 0,
        isOpen: false
    },
    currentLightboxBlobURL: null
};

// 交互模式（独立于 UIState，用于管理用户当前操作模式）
const InteractionState = {
    mode: 'normal'   // 'normal' | 'quickSelect'
};

// 如果需要跨文件访问（如 main.js 中需要读取 isEditMode），挂载到 window
window.UIState = UIState;

// ============================================================
// 🌳 树渲染
// ============================================================

// 获取当前所有展开节点的 ID（基于 DOM）
function getExpandedNodeIds() {
    const ids = [];
    const lis = document.querySelectorAll('#treeRoot li[data-node-id]');
    lis.forEach(li => {
        const container = li.querySelector(':scope > .children-container');
        if (container && container.classList.contains('open')) {
            ids.push(li.dataset.nodeId);
        }
    });
    return ids;
}

// 恢复指定节点的展开状态（仅添加 open/expanded 类）
function restoreExpandedNodeIds(ids) {
    ids.forEach(id => {
        const li = document.querySelector(`#treeRoot li[data-node-id="${id}"]`);
        if (!li) return;
        const container = li.querySelector(':scope > .children-container');
        const label = li.querySelector(':scope > .node-label');
        if (container) container.classList.add('open');
        if (label) label.classList.add('expanded');
    });
}

function renderTree() {
    // 保存当前展开状态
    const expandedIds = getExpandedNodeIds();
    const container = document.getElementById('treeRoot');
    cleanupBlobURLs(container);
    container.innerHTML = '';
    const data = Store.getTreeData();
    if (!data) return;
    renderNode(data, container);
    // 根节点始终展开
    const rootLi = container.querySelector('li');
    if (rootLi) {
        const cd = rootLi.querySelector(':scope > .children-container');
        const lb = rootLi.querySelector(':scope > .node-label');
        if (cd && lb) {
            cd.classList.add('open');
            lb.classList.add('expanded');
        }
    }
    // 恢复用户之前手动展开的节点
    restoreExpandedNodeIds(expandedIds);
    const sel = Store.getSelectedNode();
    if (sel) highlightNode(sel.id);
    updateEditButtons();
    rebuildSearchIndex();
    initTreeSortable();
}

// renderNote的辅助函数
function collapseRecursively(liElement) {
    if (!liElement) return;

    // 移除当前节点的展开样式
    const container = liElement.querySelector(':scope > .children-container');
    if (container) {
        container.classList.remove('open');
    }
    const label = liElement.querySelector(':scope > .node-label');
    if (label) {
        label.classList.remove('expanded');
    }

    // 获取后代 ul（即 children-container 内的 ul）
    const ul = liElement.querySelector(':scope > .children-container > ul');
    if (ul) {
        // 遍历直接子 li（不含占位符）
        const childLis = ul.querySelectorAll(':scope > li:not([data-placeholder="true"])');
        childLis.forEach(childLi => {
            collapseRecursively(childLi);
        });
    }
}

function renderNode(node, container) {
    const li = document.createElement('li');
    li.dataset.nodeId = node.id;
    li._node = node;
    const children = node.children || [];

    const label = document.createElement('div');
    label.className = 'node-label';
    if (node.type === 'taxon' && children.length > 0) {
        label.classList.add('node-has-children');
    } else {
        label.classList.add('node-leaf');
    }
    if (node.id === Store.getSelectedNode()?.id) label.classList.add('selected');

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    const hasTaxonChildren = children.some(c => c.type === 'taxon');
    if (hasTaxonChildren) { arrow.textContent = '▶︎'; } else if (children.length > 0) { arrow
            .textContent = '🗅︎';
        arrow.style.color = '#888'; } else { arrow.textContent = '•';
        arrow.style.color = '#bbb';
        arrow.style.fontSize = '0.7rem'; }
    label.appendChild(arrow);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'node-name';
    nameSpan.textContent = getDisplayName(node);

    const tag = document.createElement('span');
    tag.className = 'type-tag';
    if (node.type === 'content') {
        tag.classList.add('content-tag');
        tag.textContent = '笔记';
    } else {
        const rankLabel = getRankLabel(node);
        tag.textContent = rankLabel || '分类';
        // 如果节点属于种、亚种、变种、变型，应用蓝色样式
        if (isSpeciesNode(node)) {
            tag.classList.add('species-tag');
        }
    }

    nameSpan.appendChild(tag);

    if (node.photos && node.photos.length) {
        const icon = document.createElement('span');
        icon.textContent = ' 📷︎';
        icon.style.fontSize = '0.7rem';
        icon.style.color = '#888';
        nameSpan.appendChild(icon);
    }

    const isSelected = (InteractionState.mode === 'quickSelect' && Comparison.hasNode(node.id));
    if (isSelected) {
        label.classList.add('comparison-selected');
        const checkSpan = document.createElement('span');
        checkSpan.textContent = '☑ ';
        checkSpan.style.color = 'var(--primary)';
        checkSpan.style.fontWeight = 'bold';
        nameSpan.prepend(checkSpan);
    }

    label.appendChild(nameSpan);

    const actions = document.createElement('span');
    actions.className = 'node-actions';
    if (node.type !== 'root') {
        // --- 添加按钮：仅对普通分类（非物种）显示 ---
        if (node.type === 'taxon' && !isSpeciesNode(node)) {
            const b1 = document.createElement('button');
            b1.textContent = '＋';
            b1.style.fontWeight = 'bold';
            b1.title = '添加子分类';
            b1.onclick = e => { e.stopPropagation(); showAddTaxonModal(node); };
            actions.appendChild(b1);
            const b2 = document.createElement('button');
            b2.textContent = '⚘︎';
            b2.style.fontWeight = 'bold';
            b2.title = '添加物种';
            b2.onclick = e => { e.stopPropagation(); showAddSpeciesModal(node); };
            actions.appendChild(b2);
            const b3 = document.createElement('button');
            b3.textContent = '🗒︎';
            b3.style.fontWeight = 'bold';
            b3.title = '添加笔记';
            b3.onclick = e => { e.stopPropagation(); showAddContentModal(node); };
            actions.appendChild(b3);
        }
        // --- 编辑和删除按钮始终显示 ---
        const bEdit = document.createElement('button');
        bEdit.textContent = '✎';
        bEdit.style.fontWeight = 'bold';
        bEdit.title = '编辑';
        bEdit.onclick = e => { e.stopPropagation(); openEditor(node); };
        actions.appendChild(bEdit);
        const bDel = document.createElement('button');
        bDel.textContent = '✕';
        bDel.style.fontWeight = 'bold';
        bDel.className = 'del-btn';
        bDel.title = '删除';
        bDel.onclick = e => { e.stopPropagation(); deleteNode(node.id); };
        actions.appendChild(bDel);
    }
    label.appendChild(actions);

        // -------- 点击事件：展开/折叠 + 选择 --------
        label.addEventListener('click', function(e) {
            // 快速选择模式下的终端节点处理
            if (InteractionState.mode === 'quickSelect' && isTerminalNode(node)) {
                toggleComparisonNode(node, null);
                updateQuickSelectUI();   // 更新标记和计数
                return;
            }
            if (e.target.closest('button')) return;
            if (node.type === 'content') { showContentDetail(node); return; }
            if (isSpeciesNode(node)) { showSpeciesDetail(node); return; }
            // 普通分类群：展开/折叠 + 显示内容
            const cd = li.querySelector(':scope > .children-container');
            if (cd) {
                const open = cd.classList.contains('open');
                if (open) {
                    // 折叠当前节点，并递归折叠所有后代
                    collapseRecursively(li);
                } else {
                    // 只展开当前节点
                    cd.classList.add('open');
                    label.classList.add('expanded');
                }
            }
            selectNode(node);
            showTaxonContent(node);
        });

        li.appendChild(label);

    // ========== 始终为 taxon 创建 children-container ==========
    if (node.type === 'taxon') {
        const childDiv = document.createElement('div');
        childDiv.className = 'children-container';
        // 树的逐级展开
        if (node.id === 'root') {
            childDiv.classList.add('open');
            label.classList.add('expanded');
        }
        const childUl = document.createElement('ul');
        childUl.dataset.parentId = node.id;

        if (children.length > 0) {
            for (let child of children) {
                renderNode(child, childUl);
            }
        } else {
            addPlaceholder(childUl);
        }

        childDiv.appendChild(childUl);
        li.appendChild(childDiv);
    }
    // ================================================================

    container.appendChild(li);
}

// ---------- 添加占位元素 ----------
function addPlaceholder(ul) {
    // 移除可能残留的旧占位
    const existing = ul.querySelector('li[data-placeholder="true"]');
    if (existing) existing.remove();

    const placeholder = document.createElement('li');
    placeholder.dataset.placeholder = 'true';
    placeholder.className = 'empty-placeholder';
    placeholder.textContent = '⬇ 拖入下方成为子项';
    ul.appendChild(placeholder);
}

// ============================================================
// 📋 主区域内容展示（含拖拽排序）
// ============================================================

function showTaxonContent(node) {
    const parent = findParent(Store.getTreeData(), node.id);
    const mainContent = document.getElementById('mainContent');
    const emptyState = document.getElementById('emptyState');
    if (!node || node.type !== 'taxon') {
        mainContent.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';
    mainContent.style.display = 'flex';

    const allChildren = node.children || [];
    const displayChildren = allChildren;
    const count = allChildren.filter(c => c.type !== 'content').length;

    const header = document.getElementById('mainHeader');
    const currentMode = Comparison.getMode();
    const parallelActive = currentMode === 'parallel' ? ' active' : '';
    const tableActive = currentMode === 'table' ? ' active' : '';
    const comparisonHTML = `
        <button id="comparisonEntryBtn" class="btn-primary comparison-entry${InteractionState.mode === 'quickSelect' ? ' active' : ''}" onclick="toggleQuickSelect()" type="button">
            选择对比物种
        </button>
    `;

    header.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <h2 style="margin:0; font-size:1.4rem;">${escapeHtml(node.name || '未命名')} <span class="count">${count} 个子项</span></h2>
                ${parent ? `<button class="btn-primary" id="goUpBtn" style="font-size:0.78rem;padding:4px 11px;border-radius:6px;border:1px solid var(--border);background:#fff;cursor:pointer;transition:all 0.12s;color:#333;display:inline-flex;align-items:center;gap:3px;border-color:var(--primary);color:var(--primary);font-weight:500;">⬅ 上一级</button>` : ''}
            </div>
            <div class="controls">
                <div class="size-control">
                    <span style="font-size:0.75rem;color:#888;user-select:none;margin-right:2px;">小</span>
                    <input type="range" min="0" max="100" value="50" step="1" 
                        style="width:100px;vertical-align:middle;cursor:pointer;" />
                    <span style="font-size:0.75rem;color:#888;user-select:none;margin-left:2px;">大</span>
                </div>
                ${comparisonHTML}
                <button id="fontToggleBtn" class="btn-primary" onclick="toggleFont()" style="font-size:0.78rem;padding:4px 11px;border-radius:6px;border:1px solid var(--border);background:#fff;cursor:pointer;transition:all 0.12s;color:#333;display:inline-flex;align-items:center;gap:3px;border-color:var(--primary);color:var(--primary);font-weight:500;">
                    ☐ 衬线阅读模式
                </button>
                <div class="add-btns">
                    <button class="add-taxon" onclick="showAddTaxonModal(findNodeById(Store.getTreeData(), '${node.id}'))">＋ 添加子分类</button>
                    <button class="add-species" onclick="showAddSpeciesModal(findNodeById(Store.getTreeData(), '${node.id}'))">⚘︎ 添加物种</button>
                    <button class="add-content" onclick="showAddContentModal(findNodeById(Store.getTreeData(), '${node.id}'))">🗒︎ 添加笔记</button>
                </div>
            </div>
        </div>
    `;
    const upBtn = document.getElementById('goUpBtn');
    if (upBtn && parent) {
        upBtn.addEventListener('click', function() {
            jumpToNode(parent);
        });
    }

    const slider = document.querySelector('.size-control input[type="range"]');
    if (slider) {
        slider.style.pointerEvents = 'auto';
        // 读取存储的像素值 → 反推滑块位置
        let savedPx = localStorage.getItem('cardSize');
        let percent = 50; // 默认 50% → 190px
        if (savedPx) {
            const px = parseInt(savedPx, 10);
            if (!isNaN(px) && px >= 120 && px <= 400) {
                // 线性反推：percent = (px - 120) / (400 - 120) * 100
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
            }
        }

        // 保证在有效范围内
        percent = Math.min(100, Math.max(0, percent));
        slider.value = percent;
        applyCardSize(percent);

        slider.addEventListener('input', function() {
            const val = parseInt(this.value, 10);
            applyCardSize(val);
        });
    }

    const wrap = document.getElementById('mainContentWrap');
    cleanupBlobURLs(wrap);
    if (displayChildren.length === 0) {
        wrap.innerHTML = `
            <div class="card-grid" id="sortableGrid_${node.id}">
                <div class="card placeholder-card">
                    <div class="card-body" style="text-align:center;padding:16px;">
                        <div style="font-size:calc(2rem * var(--card-font-scale));rem;margin-bottom:6px;">∅</div>
                        <div style="font-size:calc(1rem * var(--card-font-scale));rem;">此分类群下暂无内容</div>
                        <div style="font-size:calc(0.8rem * var(--card-font-scale));;color:#bbb;margin-top:4px;">请在编辑模式下添加内容</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        let gridHtml = `<div class="card-grid" id="sortableGrid_${node.id}">`;
        for (let item of displayChildren) {
            gridHtml += renderCard(item);
        }
        gridHtml += `</div>`;
        wrap.innerHTML = gridHtml;
    }

    initSortable(node.id);
    loadImageRefs(wrap);

    document.querySelectorAll('.node-label').forEach(el => el.classList.remove('selected'));
    const li = document.querySelector(`li[data-node-id="${node.id}"]`);
    if (li) { const lb = li.querySelector('.node-label'); if (lb) lb.classList.add('selected'); }
    Store.setSelectedNode(node);

    updateEditButtons();
    updateFontToggleUI();
    updateComparisonEntry();
}

// ============================================================
// 🃏 渲染卡片（支持分类群、物种、笔记，均显示图片）
// ============================================================

function renderCard(item) {
    const type = item.type;
    const typeBadge = getTypeBadgeClass(item);
    const displayName = getDisplayName(item);
    const hasPhoto = (item.photos && item.photos.length > 0);
    const firstPhoto = hasPhoto ? item.photos[0] : null;
    const isSpecies = isSpeciesNode(item);

    let extraClass = '';
    let bodyExtra = '';
    let subInfo = '';
    // 移除 clickHandler 相关代码

    // 构建图片 HTML（保持不变）
    let imgHtml = '';
    if (firstPhoto) {
        const src = firstPhoto.src || '';
        const caption = firstPhoto.caption || '';
        const isRef = firstPhoto.isImageRef || false;
        const uuid = firstPhoto.uuid || '';
        const safeDisplayName = escapeAttr(displayName);
        if (isRef && uuid) {
            imgHtml = `<img data-img-uuid="${escapeAttr(uuid)}" data-caption="${escapeAttr(caption)}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="${safeDisplayName}" loading="lazy" />`;
        } else if (src) {
            const safeSrc = sanitizeUrl(src, { allowDataImage: true });
            if (safeSrc) {
                imgHtml = `<img src="${escapeAttr(safeSrc)}" data-src="${escapeAttr(safeSrc)}" data-caption="${escapeAttr(caption)}" alt="${safeDisplayName}" loading="lazy" />`;
            }
            // 若 safeSrc 为空，不生成图片（即 imgHtml 保持 ''）
        }
    }

    if (type === 'content') {
        extraClass = 'content-card';
        bodyExtra = `<div class="content-html">${renderMarkdown(item.html || '')}</div>`;
    } else if (isSpecies) {
        const profile = getProfileSafe(item);
        const sciName = profile.scientificName || item.scientificName || '';
        const author = profile.author || item.author || '';
        const commonName = profile.commonName || item.commonName || '';
        const fallbackName = commonName || item.name || '';
        let nameDisplay = sciName ? formatScientificNameWithAuthor(sciName, author) : fallbackName;
        subInfo = `<div class="sub">${nameDisplay}${hasPhoto ? ' <span class="photo-count">· 📷︎ ' + item.photos.length + '张</span>' : ''}</div>`;
    } else {
        // 普通分类群卡片
        const count = (item.children || []).filter(c => c.type !== 'content').length;
        subInfo = `<div class="sub">${count} 个子项 ${hasPhoto ? '· 🖼︎' : ''}</div>`;
    }

    const cardId = `card_${item.id}`;

    // ---- 新增：构建卡片 CSS 类 ----
    let cardClasses = 'card ' + extraClass;
    let orderBadge = '';
    if (InteractionState.mode === 'quickSelect' && Comparison.hasNode(item.id)) {
        cardClasses += ' comparison-selected';
        const nodeIds = Comparison.getNodeIds();
        const index = nodeIds.indexOf(item.id);
        if (index !== -1) {
            const orderNumbers = ['⒈', '⒉', '⒊', '⒋'];
            orderBadge = `<span class="order-badge">${orderNumbers[index] || (index + 1)}</span>`;
        }
    }

    return `
        <div class="${cardClasses}" id="${cardId}" data-node-id="${item.id}">
            ${imgHtml}
            ${orderBadge}
            <div class="card-body">
                <div class="name">
                    ${displayName}
                    <span class="type-badge ${typeBadge}">
                        ${type === 'content' ? '笔记' : (getRankLabel(item) || '分类')}
                    </span>
                </div>
                ${subInfo}
                ${bodyExtra}
            </div>
            <div class="card-actions">
                <button onclick="event.stopPropagation(); openEditor(findNodeById(Store.getTreeData(), '${item.id}'))">✎</button>
                <button class="del-btn" onclick="event.stopPropagation(); deleteNode('${item.id}')">✕</button>
            </div>
        </div>
    `;
}

// ===== 卡片尺寸控制 =====
function applyCardSize(percent) {
    const root = document.documentElement;
    percent = Math.min(100, Math.max(0, percent));

    const width = Math.round(120 + (percent / 100) * (400 - 120));
    const imgHeight = Math.round(70 + (percent / 100) * (235 - 70));
    const padding = Math.round(8 + (percent / 100) * (20 - 8));

    // 字体缩放因子
    const fontScale = 0.9 + (percent / 100) * 0.2;

    root.style.setProperty('--card-min', width + 'px');
    root.style.setProperty('--card-img-height', imgHeight + 'px');
    root.style.setProperty('--card-padding', padding + 'px');
    root.style.setProperty('--card-font-scale', fontScale.toFixed(2));  // 保留两位小数

    localStorage.setItem('cardSize', String(width));
    localStorage.removeItem('cardSizePercent');
}


// ============================================================
// 🔄 树拖拽（跨分类移动）
// ============================================================

function initTreeSortable() {
    UIState.treeSortableInstances.forEach(s => s.destroy());
    UIState.treeSortableInstances = [];

    const treeWrap = document.getElementById('treeWrap');
    const uls = treeWrap.querySelectorAll('ul');
    uls.forEach(ul => {
        const sortable = new Sortable(ul, {
            group: 'tree',
            animation: 150,
            handle: '.node-label',
            filter: 'li[data-placeholder="true"]',
            draggable: 'li:not([data-placeholder="true"])',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            disabled: !UIState.isEditMode,

            onEnd: function(evt) {
                const item = evt.item;
                const nodeId = item.dataset.nodeId;
                if (!nodeId || nodeId === 'root') return;
                const node = findNodeById(Store.getTreeData(), nodeId);
                if (!node) return;

                const targetUl = evt.to;
                let parentLi = targetUl.closest('li');
                let targetParentId = parentLi ? parentLi.dataset.nodeId : 'root';
                const tree = Store.getTreeData();
                let targetParent = targetParentId === 'root'
                    ? tree
                    : findNodeById(tree, targetParentId);
                if (!targetParent) return;

                const realChildren = Array.from(targetUl.children)
                    .filter(li => !li.dataset.placeholder);
                const newIndex = realChildren.indexOf(item);

                if (newIndex === -1) {
                    saveAndRefresh();
                    return;
                }

                if (targetParent.id === nodeId) {
                    toast('❌ 不能将节点移动到自身');
                    saveAndRefresh();
                    return;
                }

                function checkDescendant(parent, childId) {
                    if (!parent.children) return false;
                    for (let c of parent.children) {
                        if (c.id === childId) return true;
                        if (checkDescendant(c, childId)) return true;
                    }
                    return false;
                }
                if (checkDescendant(node, targetParent.id)) {
                    toast('❌ 不能将节点移动到自己的子节点下');
                    saveAndRefresh();
                    return;
                }

                const oldParent = findParent(Store.getTreeData(), nodeId);
                if (!oldParent) return;

                if (oldParent.id === targetParent.id) {
                    const oldIndex = oldParent.children.findIndex(c => c.id === nodeId);
                    if (oldIndex !== -1 && oldIndex !== newIndex) {
                        const [removed] = oldParent.children.splice(oldIndex, 1);
                        oldParent.children.splice(newIndex, 0, removed);
                        saveData();
                        renderTree();
                        const selected = Store.getSelectedNode();
                        if (selected) {
                            const refreshed = findNodeById(Store.getTreeData(), selected.id);
                            if (refreshed) {
                                Store.setSelectedNode(refreshed);
                                showTaxonContent(refreshed);
                            } else {
                                Store.setSelectedNode(Store.getTreeData());
                                showTaxonContent(Store.getTreeData());
                            }
                        }
                        toast('✅ 排序已更新');
                    }
                    return;
                }

                const oldIndex = oldParent.children.findIndex(c => c.id === nodeId);
                if (oldIndex === -1) return;
                const [movedNode] = oldParent.children.splice(oldIndex, 1);
                if (!targetParent.children) targetParent.children = [];
                targetParent.children.splice(newIndex, 0, movedNode);

                saveData();
                renderTree();
                expandPath(targetParent.id);
                selectNode(targetParent);
                showTaxonContent(targetParent);
                toast(`✅ 已将「${getDisplayName(movedNode)}」移动到「${getDisplayName(targetParent)}」`);
            }, 

            onDragEnter: function(evt) {
                const targetUl = evt.to;
                if (!targetUl) return;
                const placeholder = targetUl.querySelector('li[data-placeholder="true"]');
                if (placeholder) {
                    placeholder.style.borderColor = '#2c7a4a';
                    placeholder.style.background = '#e8f5e9';
                    placeholder.style.color = '#2c7a4a';
                    placeholder.style.transition = 'all 0.15s ease';
                }
            },

            onDragLeave: function(evt) {
                const targetUl = evt.to;
                if (!targetUl) return;
                const placeholder = targetUl.querySelector('li[data-placeholder="true"]');
                if (placeholder) {
                    placeholder.style.borderColor = '#d0d7de';
                    placeholder.style.background = '#fafbfc';
                    placeholder.style.color = '#aaa';
                }
            }
        });
        UIState.treeSortableInstances.push(sortable);
    });
}

// ============================================================
// 🔄 Sortable 拖拽初始化（卡片）
// ============================================================

function initSortable(parentId) {
    UIState.sortableInstances.forEach(s => s.destroy());
    UIState.sortableInstances = [];

    const grid = document.getElementById(`sortableGrid_${parentId}`);
    if (!grid) return;

    const sortable = new Sortable(grid, {
        animation: 200,
        draggable: '.card:not(.placeholder-card)',
        handle: '.card',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        delay: 100,
        delayOnTouchOnly: true,
        disabled: !UIState.isEditMode,

        onEnd: function(evt) {
            const items = grid.querySelectorAll('.card:not(.placeholder-card)');
            const newOrder = [];
            for (let el of items) {
                const id = el.dataset.nodeId;
                if (id) newOrder.push(id);
            }
            const parent = findNodeById(Store.getTreeData(), parentId);
            if (!parent) return;
            const newChildren = [];
            for (let id of newOrder) {
                const found = parent.children.find(c => c.id === id);
                if (found) newChildren.push(found);
            }
            for (let c of parent.children) {
                if (!newChildren.find(n => n.id === c.id)) {
                    newChildren.push(c);
                }
            }
            parent.children = newChildren;
            saveData();
            // 同步左侧树，并保持当前展开状态（由 renderTree 内部处理）
            renderTree();
            // 刷新右侧内容（确保与数据一致）
            showTaxonContent(parent);
            selectNode(parent);
            toast('✅ 排序已保存');
        }
    });

    UIState.sortableInstances.push(sortable);
}

// ============================================================
// 🖼 图片列表排序功能（模态框内）—— 使用 setImageBlob 管理 ObjectURL
// ============================================================

function initImageSortable(modalElement) {
    const textareas = modalElement.querySelectorAll('textarea[data-image-field="true"]');
    
    textareas.forEach(textarea => {
        const fieldId = textarea.id;
        
        // 创建预览容器（每个 textarea 对应一个容器）
        const container = document.createElement('div');
        container.className = 'image-sortable-list';
        container.id = 'preview_' + fieldId;
        textarea.parentNode.insertBefore(container, textarea.nextSibling);

        // ===== 核心渲染函数 =====
        function renderPreview() {
            // ---------- 第1步：销毁旧的 Sortable 实例 ----------
            if (container._sortableInstance) {
                container._sortableInstance.destroy();
                container._sortableInstance = null;
            }

            // ---------- 第2步：清理容器内所有图片的 ObjectURL ----------
            const oldImages = container.querySelectorAll('.img-preview');
            oldImages.forEach(img => {
                if (img._blobURL) {
                    URL.revokeObjectURL(img._blobURL);
                    img._blobURL = null;
                }
            });

            // ---------- 第3步：解析数据 ----------
            const images = parseImageField(textarea.value);
            
            // 清空容器
            container.innerHTML = '';

            // 如果无图片，显示占位提示
            if (images.length === 0) {
                container.innerHTML = `
                    <div style="color:#bbb;text-align:center;padding:8px;font-size:0.8rem;">
                        暂无图片，请在上方输入或粘贴
                    </div>
                `;
                return;
            }

            // ---------- 第4步：渲染每个图片项 ----------
            images.forEach((img, index) => {
                const item = document.createElement('div');
                item.className = 'image-item';
                item.dataset.index = index;

                const isRef = img.src.startsWith('[img:');

                // ---- 1. 拖拽手柄 ----
                const handle = document.createElement('span');
                handle.className = 'drag-handle';
                handle.textContent = '⠿';

                // ---- 2. 预览图片 ----
                const preview = document.createElement('img');
                preview.className = 'img-preview';
                preview.alt = '预览';

                if (isRef) {
                    // IndexedDB 引用：先占位，后续异步加载
                    preview.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                } else {
                    // 普通 URL：过 sanitizeUrl 过滤，拒绝不安全协议
                    const safeSrc = sanitizeUrl(img.src);
                    if (safeSrc) {
                        preview.src = safeSrc;
                    }
                    // 若 safeSrc 为空，则不设置 src（图片不显示）
                }
                // 移除内联 onerror，改用事件监听
                preview.addEventListener('error', function() {
                    this.style.display = 'none';
                });

                // ---- 3. 图片信息 ----
                const imgInfo = document.createElement('span');
                imgInfo.className = 'img-info';

                // URL 文本（截取显示）
                const srcSpan = document.createElement('span');
                const displaySrc = img.src.length > 40 ? img.src.slice(0, 40) + '…' : img.src;
                srcSpan.textContent = displaySrc;  // textContent 防注入

                // 说明文字
                const captionSpan = document.createElement('span');
                captionSpan.className = 'caption';
                captionSpan.textContent = img.caption || '';  // textContent 防注入

                imgInfo.appendChild(srcSpan);
                imgInfo.appendChild(captionSpan);

                // ---- 4. 移除按钮 ----
                const removeSpan = document.createElement('span');
                removeSpan.className = 'img-remove';
                removeSpan.title = '移除';
                removeSpan.textContent = '✕';

                // ---- 5. 组装 ----
                // 清空 item 原有内容，再按序添加
                item.innerHTML = '';
                item.appendChild(handle);
                item.appendChild(preview);
                item.appendChild(imgInfo);
                item.appendChild(removeSpan);

                // 如果是 IndexedDB 引用，异步加载真实图片
                if (isRef) {
                    const uuid = img.src.replace('[img:', '').replace(']', '');
                    const preview = item.querySelector('.img-preview');
                    if (preview) {
                        getImageFromDB(uuid)
                            .then(blob => {
                                if (blob) {
                                    setImageBlob(preview, blob);
                                } else {
                                    setImageBlob(preview, null);
                                }
                            })
                            .catch(() => {
                                setImageBlob(preview, null);
                            });
                    }
                }

                // 删除按钮事件
                item.querySelector('.img-remove').addEventListener('click', function(e) {
                    e.stopPropagation();
                    const idx = parseInt(item.dataset.index);
                    const lines = textarea.value.split('\n').filter(s => s.trim());
                    lines.splice(idx, 1);
                    textarea.value = lines.join('\n');
                    textarea.dispatchEvent(new Event('input'));
                    // input 事件会自动触发 renderPreview
                });

                container.appendChild(item);
            });

            // ---------- 第5步：创建新的 Sortable 实例 ----------
            if (window.Sortable) {
                container._sortableInstance = new Sortable(container, {
                    animation: 150,
                    handle: '.drag-handle',
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    dragClass: 'sortable-drag',

                    onEnd: function(evt) {
                        // ===== 性能优化：只 split 一次 =====
                        const lines = textarea.value.split('\n').filter(s => s.trim());
                        const items = container.querySelectorAll('.image-item');
                        const newOrder = [];

                        items.forEach(el => {
                            const idx = parseInt(el.dataset.index);
                            if (idx < lines.length) {
                                newOrder.push(lines[idx]);
                            }
                        });

                        textarea.value = newOrder.join('\n');
                        textarea.dispatchEvent(new Event('input'));
                        // input 事件会自动触发 renderPreview，实现 UI 刷新
                    }
                });
            }
        }

        // 监听输入变化，实时预览
        textarea.addEventListener('input', renderPreview);
        // 首次渲染
        renderPreview();
    });
}

// ============================================================
// 🧩 模态框
// ============================================================

function showModal(options) {
    const overlay = document.getElementById('genericModal');

    // 如果旧模态框处于打开状态，尝试关闭（带脏检查）
    if (overlay && overlay.classList.contains('active')) {
        tryCloseModal(overlay);
        // 如果用户取消关闭，则停止创建新模态框
        if (overlay.classList.contains('active')) {
            return;
        }
    }

    const body = document.getElementById('modalBody');

    // ---------- 辅助：渲染字段 ----------
    function renderField(f) {
        const val = f.value || '';
        const placeholder = f.placeholder || '';
        const rows = f.rows || 3;
        const withPaste = f.withPaste || false;
        const isImageField = f.isImageField || false;
        let pasteBtn = '';
        if (withPaste) {
            // 生成唯一的 file input id
            const fileInputId = `fileInput_${f.id}`;
            pasteBtn = `
                <div class="paste-area">
                    <button class="paste-btn" onclick="pasteImageFromClipboard('modal_${f.id}')">📋︎ 从剪贴板粘贴图片</button>
                    <button class="upload-btn" data-upload-button="${fileInputId}">📁︎ 上传本地图片</button>
                    <input type="file" id="${fileInputId}" accept="image/*" multiple data-upload-target="modal_${f.id}" style="display:none;" />
                    <span style="font-size:0.75rem;color:#999;">（支持 JPG/PNG/WEBP/GIF，单文件 <30MB）</span>
                </div>
            `;
        }
        let imageFieldAttr = isImageField ? ' data-image-field="true"' : '';
        let html = '';

        if (f.type === 'textarea') {
            html = `
                <div class="form-group">
                    <label>${f.label}</label>
                    <textarea id="modal_${f.id}" placeholder="${placeholder}" rows="${rows}"${imageFieldAttr}>${val}</textarea>
                    ${pasteBtn}
                </div>
            `;
        } else if (f.type === 'select') {
            let optionsHtml = '';
            if (f.options && f.options.length) {
                for (let opt of f.options) {
                    const selected = (opt.value === val) ? 'selected' : '';
                    optionsHtml += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
                }
            }
            const rankNameField = f.rankNameField || '';
            html = `
                <div class="form-group">
                    <label>${f.label}</label>
                    <select id="modal_${f.id}" ${rankNameField ? `data-rank-name-field="modal_${rankNameField}"` : ''}>
                        ${optionsHtml}
                    </select>
                </div>
            `;
          } else if (f.type === 'checkbox') {
                const checked = f.checked ? 'checked' : '';

                html = `
                    <div class="form-group checkbox-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="modal_${f.id}" ${checked}>
                            <span>${f.label}</span>
                        </label>
                    </div>
                `;
        } else {
            // 普通 text，支持 hidden
            const hiddenStyle = f.hidden ? 'display:none;' : '';
            const disabledAttr = f.hidden ? 'disabled' : '';
            html = `
                <div class="form-group">
                    <label>${f.label}</label>
                    <input type="text" id="modal_${f.id}" placeholder="${placeholder}" value="${val}" style="${hiddenStyle}" ${disabledAttr} />
                </div>
            `;
        }
        return html;
    }

    // ---------- 解析字段并分组 ----------
    function buildHTML(fields) {
        if (!fields || fields.length === 0) return '';

        // 检查是否有分组标记（group-start）
        const hasGroups = fields.some(f => f.type === 'group-start' || f.type === 'group-end');

        // ===== 情况1：无分组（平铺字段） =====
        if (!hasGroups) {
            let html = '';
            let i = 0;
            while (i < fields.length) {
                const current = fields[i];
                if (current.inline) {
                    // 收集连续的 inline 字段
                    const rowFields = [];
                    while (i < fields.length && fields[i].inline) {
                        rowFields.push(fields[i]);
                        i++;
                    }
                    if (rowFields.length === 1) {
                        html += renderField(rowFields[0]);
                    } else {
                        html += `<div class="form-row">`;
                        for (let rf of rowFields) {
                            html += renderField(rf);
                        }
                        html += `</div>`;
                    }
                } else {
                    html += renderField(current);
                    i++;
                }
            }
            return html;
        }

        // ===== 情况2：有分组（现有逻辑） =====
        let html = '';
        let i = 0;
        while (i < fields.length) {
            const f = fields[i];
            if (f.type === 'group-start') {
                html += `<div class="form-section">`;
                html += `<h3 class="form-section-title">${f.label}</h3>`;
                i++;
                const groupFields = [];
                while (i < fields.length && fields[i].type !== 'group-end') {
                    groupFields.push(fields[i]);
                    i++;
                }
                // 渲染组内字段（同样处理 inline）
                let j = 0;
                while (j < groupFields.length) {
                    const current = groupFields[j];
                    if (current.inline) {
                        const rowFields = [];
                        while (j < groupFields.length && groupFields[j].inline) {
                            rowFields.push(groupFields[j]);
                            j++;
                        }
                        if (rowFields.length === 1) {
                            html += renderField(rowFields[0]);
                        } else {
                            html += `<div class="form-row">`;
                            for (let rf of rowFields) {
                                html += renderField(rf);
                            }
                            html += `</div>`;
                        }
                    } else {
                        html += renderField(current);
                        j++;
                    }
                }
                if (i < fields.length && fields[i].type === 'group-end') {
                    html += `</div>`;
                    i++;
                }
            } else {
                // 忽略其他非 group-start 顶层（安全保护）
                i++;
            }
        }
        return html;
    }

    // ---------- 构建最终内容 ----------
    let fieldsHTML = options.fields ? buildHTML(options.fields) : '';
    let contentHTML = options.content || '';

    cleanupBlobURLs(body);
    body.innerHTML = `
        <div class="modal-header">
            <h2>${options.title || '编辑'}</h2>
        </div>
        <div class="modal-body">
            ${fieldsHTML}
            ${contentHTML}
        </div>
        ${options.hideFooter ? '' : `
        <div class="modal-footer">
            <button class="btn-cancel" onclick="tryCloseModal(document.getElementById('genericModal'))">取消</button>
            <button class="btn-save" id="modalSaveBtn">${options.saveText || '💾︎ 保存'}</button>
        </div>
        `}
    `;

    // --- 结构化整理描述 & 句号换行 checkbox 绑定（同步，无 setTimeout） ---
    const structCheck = document.getElementById('modal_structCheck');
    const sentenceBreak = document.getElementById('modal_sentenceBreak');
    const textarea = document.getElementById('modal_description');

    if ((structCheck || sentenceBreak) && textarea) {
        let rawSnapshot = null; // 闭包存储原始快照

        function applyTransformations(text) {
            let result = text;
            // 先执行句号换行
            if (sentenceBreak && sentenceBreak.checked) {
                result = applySentenceBreak(result);
            }
            // 再执行结构化整理
            if (structCheck && structCheck.checked) {
                result = structureDescription(result);
            }
            return result;
        }

        function updateText() {
            const isStructChecked = structCheck && structCheck.checked;
            const isSentenceChecked = sentenceBreak && sentenceBreak.checked;

            if (isStructChecked || isSentenceChecked) {
                // 如果任一 checkbox 被勾选，保存快照并应用变换
                if (rawSnapshot === null) {
                    rawSnapshot = textarea.value;
                }
                textarea.value = applyTransformations(rawSnapshot);
            } else {
                // 两个都取消，恢复原始快照
                if (rawSnapshot !== null) {
                    textarea.value = rawSnapshot;
                    rawSnapshot = null;
                }
            }
        }

        // 两个 checkbox 共用同一个处理函数
        if (structCheck) structCheck.onchange = updateText;
        if (sentenceBreak) sentenceBreak.onchange = updateText;
    }

    // dirty
    overlay.classList.add('active');
    overlay._dirty = false;

    // 绑定 rank 自定义切换
    setTimeout(() => {
        bindRankCustomToggle(document.getElementById('modalContainer'));
        bindImageUploadEvents(document.getElementById('modalContainer'));
    }, 50);

    // 绑定输入变化
    body.querySelectorAll('input, textarea, select').forEach(el => {
        ['input', 'change'].forEach(type => {
            el.addEventListener(type, function onInput() {
                overlay._dirty = true;
            });
        });
    });

    // 图片排序初始化
    if (!options.hideFooter) {
        setTimeout(() => {
            initImageSortable(document.getElementById('modalContainer'));
        }, 50);
    }

    // 保存按钮
    if (!options.hideFooter) {
        document.getElementById('modalSaveBtn').onclick = function() {
            const data = {};
            if (options.fields) {
                for (let f of options.fields) {
                    if (f.type === 'group-start' || f.type === 'group-end') continue;
                    const el = document.getElementById('modal_' + f.id);
                    if (el) data[f.id] = el.value;
                }
            }
            if (options.onSave) {
                const result = options.onSave(data);
                if (result !== false) {
                    overlay._dirty = false;
                    closeModal();
                }
            } else {
                overlay._dirty = false;
                closeModal();
            }
        };
    }

    document.getElementById('modalCloseBtn').onclick = function() {
        tryCloseModal(overlay);
        if (options.onClose) options.onClose();
    };

    overlay.onclick = null;
    if (options.allowOverlayClose) {
        overlay.onclick = function(e) {
            if (e.target === overlay) {
                tryCloseModal(overlay);
                if (options.onClose) options.onClose();
            }
        };
    }
}

function tryCloseModal(overlay) {
    if (!overlay) {
            overlay = document.getElementById('genericModal');
        if (!overlay || !overlay.classList.contains('active')) return;
    }
    if (!overlay._dirty) {
        closeModal();
        return;
    }
    if (confirm('当前修改尚未保存，确定放弃吗？')) {
        closeModal();
    }
}

function closeModal() {
    const overlay = document.getElementById('genericModal');
    if (!overlay) return;

    // ---------- 清理所有图片排序容器 ----------
    const containers = overlay.querySelectorAll('.image-sortable-list');
    containers.forEach(container => {
        //销毁 Sortable 实例
        if (container._sortableInstance) {
            container._sortableInstance.destroy();
            container._sortableInstance = null;
        }
        cleanupBlobURLs(container);
        //清空容器内容
        container.innerHTML = '';
    });

    // ---------- 关闭模态框 ----------
    overlay.classList.remove('active');
}

// ============================================================
// 📄 物种详情（使用事件委托）
// ============================================================

function buildSpeciesDetailHTML(node, options = {}) {

    const safe = (str) => typeof str === 'string' ? escapeHtml(str) : '';
    if (!node) return '<p style="color:#999;">无效的物种节点</p>';

    const profile = getProfileSafe(node);

    const showEmptyFields = options.showEmptyFields || false;
    const addSectionData = options.addSectionData || false;
    const alwaysShowToggle = options.alwaysShowToggle || false;

    const sciName = profile.scientificName || node.scientificName || '';
    const author = profile.author || node.author || '';
    const commonName = profile.commonName || node.commonName || '';
    const displayName = formatScientificNameWithAuthor(sciName, author);

    // ---- 辅助：判断字段是否有内容 ----
    function hasContent(val) {
        if (val === undefined || val === null) return false;
        if (typeof val === 'string') return val.trim().length > 0;
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'object') {
            if (val.text && val.text.trim()) return true;
            if (val.link && val.link.trim()) return true;
            return false;
        }
        return !!val;
    }

    // ---- 1. 面包屑 ----
    let breadcrumbHTML = '';
    if (options.showBreadcrumb !== false) {
        const pathNodes = getNodePath(node.id);
        if (pathNodes.length > 0) {
            const crumbs = pathNodes.map((n, index) => {
                const isLast = index === pathNodes.length - 1;
                const name = safe(getDisplayName(n));
                if (isLast) {
                    return `<span class="breadcrumb-current">${name}</span>`;
                } else {
                    return `<span class="breadcrumb-link" data-node-id="${n.id}">${name}</span>`;
                }
            }).join(' › ');
            breadcrumbHTML = `<div class="breadcrumb">${crumbs}</div>`;
        }
    }

    // ---- 2. 分类学信息 ----
    const synonyms = (profile.synonyms && profile.synonyms.length) ? profile.synonyms : (node.synonyms || []);
    const protologue = (profile.protologue && (profile.protologue.text || profile.protologue.link))
    ? profile.protologue
    : (node.protologue || { text: '', link: '' });
    const typeInfo = (profile.typeInformation && (profile.typeInformation.text || profile.typeInformation.link))
    ? profile.typeInformation
    : (node.typeInformation || { text: '', link: '' });
    const specimens = (Array.isArray(profile.specimens) && profile.specimens.length)
    ? profile.specimens
    : (Array.isArray(node.specimens) ? node.specimens : []);

    const hasSynonym = synonyms.length > 0;
    const hasProtologue = hasContent(protologue.text) || hasContent(protologue.link);
    const hasTypeInfo = hasContent(typeInfo.text) || hasContent(typeInfo.link);
    const hasTaxonomyInfo = hasSynonym || hasProtologue || hasTypeInfo || specimens.length > 0;

    let taxonomyHTML = '';
    if (hasTaxonomyInfo || showEmptyFields) {
        let items = '';

        // 异名
        if (hasSynonym || showEmptyFields) {
            let synonymListHtml;
            if (hasSynonym) {
                synonymListHtml = synonyms.map(s => {
                    let textHtml = '';
                    if (s.text && s.text.trim()) {
                        const parsed = parseScientificName(s.text);
                        textHtml = formatScientificNameWithAuthor(parsed.scientificName, parsed.author);
                        if (!textHtml) textHtml = safe(s.text);
                    } else {
                        textHtml = safe(s.text || '');
                    }
                    if (s.link) {
                        const safeLink = sanitizeUrl(s.link);
                        if (safeLink) {
                            textHtml = `<a href="${escapeAttr(safeLink)}" target="_blank" rel="noopener noreferrer">${textHtml}</a>`;
                        }
                        // 若链接不安全，则忽略链接，只显示转义后的文本
                    }
                    return `<li class="synonym-item">${textHtml}</li>`;
                }).join('');
            } else {
                synonymListHtml = `<li class="synonym-item"><span class="empty-value">—</span></li>`;
            }
            items += `
                <div class="item synonym-grid-item">
                    <div class="synonym-section">
                        <div class="synonym-header">
                            <span>异名</span>
                            <span class="synonym-count">(${synonyms.length})</span>
                            <span class="collapse-icon">›</span>
                        </div>
                        <div class="synonym-content">
                            <ul class="synonym-list">${synonymListHtml}</ul>
                        </div>
                    </div>
                </div>
            `;
        }

        // 原始发表
        if (hasProtologue || showEmptyFields) {
            const content = hasProtologue ? renderAnnotatedText(protologue) : '<span class="empty-value">—</span>';
            items += `<div class="item"><strong>原始发表</strong><span>${content}</span></div>`;
        }

        // 模式信息
        if (hasTypeInfo || showEmptyFields) {
            const content = hasTypeInfo ? renderAnnotatedText(typeInfo) : '<span class="empty-value">—</span>';
            items += `<div class="item"><strong>模式信息</strong><span>${content}</span></div>`;
        }

        // 标本
        if (specimens.length > 0 || showEmptyFields) {
            let specimenListHtml;
            if (specimens.length > 0) {
                specimenListHtml = specimens.map(s => `<li class="synonym-item">${renderAnnotatedText(s)}</li>`).join('');
            } else {
                specimenListHtml = `<li class="synonym-item"><span class="empty-value">—</span></li>`;
            }
            items += `
                <div class="item synonym-grid-item">
                    <div class="synonym-section">
                        <div class="synonym-header">
                            <span>标本</span>
                            <span class="synonym-count">(${specimens.length})</span>
                            <span class="collapse-icon">›</span>
                        </div>
                        <div class="synonym-content">
                            <ul class="synonym-list">${specimenListHtml}</ul>
                        </div>
                    </div>
                </div>
            `;
        }

        const sectionAttr = addSectionData ? ' data-section="taxonomy"' : '';
        taxonomyHTML = `
            <div class="detail-section"${sectionAttr}>
                <h2 class="detail-section-title">分类学信息</h2>
                <div class="detail-grid">${items}</div>
            </div>
        `;
    }

    // ---- 3. 生态与分布 ----
    const distribution = (Array.isArray(profile.distribution) && profile.distribution.length)
        ? profile.distribution
        : (Array.isArray(node.distribution) ? node.distribution : []);
    const habitat = profile.habitat || node.habitat || '';
    const phenologyItems = (Array.isArray(profile.phenology) && profile.phenology.length)
        ? profile.phenology
        : (Array.isArray(node.phenology) ? node.phenology : []);
    const localities = (Array.isArray(profile.localities) && profile.localities.length)
        ? profile.localities
        : (Array.isArray(node.localities) ? node.localities : []);

    const hasDist = distribution.length > 0;
    const hasHabitat = hasContent(habitat);
    const hasPheno = phenologyItems.length > 0;
    const hasLocalities = localities.length > 0;
    const hasEcoDist = hasDist || hasHabitat || hasPheno || hasLocalities;

    let ecoDistHTML = '';
    if (hasEcoDist || showEmptyFields) {
        let items = '';

        // ---- 分布 ----
        if (hasDist || showEmptyFields) {
            let distText;
            if (hasDist) {
                distText = distribution.map(d => {
                    const country = safe(d.country || '');
                    const areas = (d.areas || []).map(safe).join('，');
                    return areas ? `${country}（${areas}）` : country;
                }).join('；');
            } else {
                distText = '<span class="empty-value">—</span>';
            }
            items += `<div class="item"><strong>分布</strong><span>${distText}</span></div>`;
        }

        // ---- 生境 ----
        if (hasHabitat || showEmptyFields) {
            const content = hasHabitat ? safe(habitat) : '<span class="empty-value">—</span>';
            items += `<div class="item"><strong>生境</strong><span>${content}</span></div>`;
        }

        // ---- 物候（条带） ----
        let phenoStripHTML = '';
        if (hasPheno || showEmptyFields) {
            if (hasPheno) {
                for (const item of phenologyItems) {
                    const label = safe(item.label || '物候');
                    const value = safe(item.value || '');
                    const months = item.months || [];
                    let stripHTML = '';
                    if (months.length > 0) {
                        const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
                        const bars = monthNames.map((name, idx) => {
                            const isActive = months.includes(idx + 1);
                            return `<span class="pheno-month ${isActive ? 'active' : ''}">${name}</span>`;
                        }).join('');
                        stripHTML = `<div class="pheno-strip">${bars}</div>`;
                    } else {
                        stripHTML = `<div class="pheno-strip-empty">（无月份数据）</div>`;
                    }
                    phenoStripHTML += `
                        <div class="pheno-item">
                            <div class="pheno-label"><strong>${label}</strong> ${value}</div>
                            ${stripHTML}
                        </div>
                    `;
                }
            } else {
                // 空物候显示占位
                phenoStripHTML = `
                    <div class="pheno-item">
                        <div class="pheno-label"><strong>物候</strong></div>
                        <div class="pheno-strip-empty"><span class="empty-value">—</span></div>
                    </div>
                `;
            }
        }

        // ---- 点位记录 ----
        if (hasLocalities || showEmptyFields) {
            let locItems;
            if (hasLocalities) {
                locItems = localities.map(l => {
                    const text = `${safe(l.coordinate)}${l.description ? ' - ' + safe(l.description) : ''}`;
                    return `<li class="synonym-item">${text}</li>`;
                }).join('');
            } else {
                locItems = `<li class="synonym-item"><span class="empty-value">—</span></li>`;
            }
            items += `
                <div class="item synonym-grid-item">
                    <div class="synonym-section">
                        <div class="synonym-header">
                            <span>点位记录</span>
                            <span class="synonym-count">(${localities.length})</span>
                            <span class="collapse-icon">›</span>
                        </div>
                        <div class="synonym-content">
                            <ul class="synonym-list">${locItems}</ul>
                        </div>
                    </div>
                </div>
            `;
        }

        const sectionAttr = addSectionData ? ' data-section="ecology"' : '';
        ecoDistHTML = `
            <div class="detail-section"${sectionAttr}>
                <h2 class="detail-section-title">生态与分布</h2>
                ${items ? `<div class="detail-grid">${items}</div>` : ''}
                ${phenoStripHTML}
            </div>
        `;
    }

    // ---- 4. 相册 ----
    let photoHTML = '';
    const photos = node.photos || [];
    if (photos.length > 0) {
        const photoItems = photos.map(p => createPhotoHTML(p)).filter(html => html !== '');
        const totalCount = photoItems.length;
        const hasMore = (options.alwaysShowToggle === true) || (totalCount > 3 && options.showAlbumToggle !== false);

        let stripContent = photoItems.map(html => {
            return html.replace(/<img/, `<img class="photo-img"`);
        }).join('');

        const sectionAttr = addSectionData ? ' data-section="album"' : '';
        photoHTML = `
            <div class="detail-section"${sectionAttr}>
                <h2 class="detail-section-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>相册</span>
                    ${hasMore ? `<button class="photo-toggle-btn" data-toggle="photo">展开所有图片（${totalCount}）</button>` : ''}
                </h2>
                <div class="photo-strip" data-photo-strip>
                    ${stripContent}
                </div>
            </div>
        `;
    }

    // ---- 5. 形态与讨论 ----
    const diagnosis = profile.diagnosis || node.diagnosis || '';
    const description = profile.description || node.description || '';
    const etymology = profile.etymology || '';
    const discussion = profile.discussion || node.discussion || '';

    const hasDiagnosis = hasContent(diagnosis);
    const hasDescription = hasContent(description);
    const hasEtymology = hasContent(etymology);
    const hasDiscussion = hasContent(discussion);
    const hasMorph = hasDiagnosis || hasDescription || hasEtymology || hasDiscussion;

    let morphHTML = '';
    if (hasMorph || showEmptyFields) {
        let parts = '';

        // 鉴定要点
        if (hasDiagnosis || showEmptyFields) {
            const content = hasDiagnosis ? renderMarkdown(diagnosis) : '<span class="empty-value">—</span>';
            // 👇 添加 data-subsection 和 className
            parts += `<div class="morph-subsection" data-subsection="diagnosis">
                        <h3 class="section-title">鉴定要点</h3>
                        <div class="markdown-body">${content}</div>
                    </div>`;
        }

        // 物种描述
        if (hasDescription || showEmptyFields) {
            const content = hasDescription ? renderMarkdown(description) : '<span class="empty-value">—</span>';
            parts += `<div class="morph-subsection" data-subsection="description">
                        <h3 class="section-title">物种描述</h3>
                        <div class="markdown-body">${content}</div>
                    </div>`;
        }

        // 词源
        if (hasEtymology || showEmptyFields) {
            const content = hasEtymology ? renderMarkdown(etymology) : '<span class="empty-value">—</span>';
            parts += `<div class="morph-subsection" data-subsection="etymology">
                        <h3 class="section-title">词源</h3>
                        <div class="markdown-body">${content}</div>
                    </div>`;
        }

        // 讨论
        if (hasDiscussion || showEmptyFields) {
            const content = hasDiscussion ? renderMarkdown(discussion) : '<span class="empty-value">—</span>';
            parts += `<div class="morph-subsection" data-subsection="discussion">
                        <h3 class="section-title">讨论</h3>
                        <div class="markdown-body">${content}</div>
                    </div>`;
        }

        const sectionAttr = addSectionData ? ' data-section="morphology"' : '';
        morphHTML = `
            <div class="detail-section"${sectionAttr}>
                <h2 class="detail-section-title">形态与讨论</h2>
                ${parts}
            </div>
        `;
    }

    // ---- 6. 参考文献 ----
    const references = (profile.references && profile.references.length) ? profile.references : (node.references || []);
    let refHTML = '';
    if (references.length > 0 || showEmptyFields) {
        let refList;
        if (references.length > 0) {
            refList = references.map(r => `<li>${renderAnnotatedText(r)}</li>`).join('');
        } else {
            refList = `<li><span class="empty-value">—</span></li>`;
        }
        const sectionAttr = addSectionData ? ' data-section="references"' : '';
        refHTML = `
            <div class="detail-section"${sectionAttr}>
                <h2 class="detail-section-title">参考文献</h2>
                <ol class="ref-list">${refList}</ol>
            </div>
        `;
    }

    // ---- 7. 空状态 ----
    const hasAnyContent = hasTaxonomyInfo || hasEcoDist || photoHTML || hasMorph || refHTML;

    // ---- 组装最终 HTML ----
    const editButtonHTML = (options.showEditButton && UIState.isEditMode) ?
        `<button class="btn-save" onclick="document.getElementById('speciesModal').classList.remove('active'); openEditor(findNodeById(Store.getTreeData(), '${node.id}'))">✎ 编辑</button>` :
        '';

    const comparisonButtonHTML = (options.showComparisonToggle) ?
    `<button class="btn-comparison" onclick="toggleComparisonNode(findNodeById(Store.getTreeData(), '${node.id}'), this)">
        ${Comparison.hasNode(node.id) ? '✓ 已加入对比' : '＋ 加入对比'}
    </button>` :
    '';

    return `
        <div class="modal-header">
            <h2>${safe(commonName) || safe(sciName) || safe(node.name) || '未命名物种'}</h2>
            <div class="sub">${displayName}</div>
            ${breadcrumbHTML}
        </div>
        <div class="modal-body">
            ${taxonomyHTML}
            ${ecoDistHTML}
            ${photoHTML}
            ${morphHTML}
            ${refHTML}
            ${!hasAnyContent ? '<p style="color:#999;">该物种暂无详细信息</p>' : ''}
        </div>
        <div class="modal-footer">
            <button class="btn-cancel" onclick="document.getElementById('speciesModal').classList.remove('active')">关闭</button>
            ${comparisonButtonHTML}
            ${editButtonHTML}
        </div>
    `;
}

function mountSpeciesDetailContent(container, html, options = {}) {
    if (!container) {
        console.warn('[mountSpeciesDetailContent] container is null');
        return;
    }

    // ---- 1. 清理旧的 Blob URLs ----
    cleanupBlobURLs(container);

    // ---- 2. 挂载 HTML ----
    container.innerHTML = html;

    // ---- 3. 异名折叠（若启用） ----
    if (options.setupCollapse !== false) {
        const headers = container.querySelectorAll('.synonym-header');
        headers.forEach(header => {
            // 移除旧监听（用克隆替换避免重复绑定）
            // 但由于每次重新挂载都是新的 DOM，直接绑定即可
            header.addEventListener('click', function(e) {
                const content = this.nextElementSibling;
                const icon = this.querySelector('.collapse-icon');
                if (content) {
                    content.classList.toggle('open');
                    if (icon) icon.classList.toggle('open');
                    if (typeof options.onToggle === 'function') {
                        options.onToggle();
                    }
                }
            });
        });
    }

    // ---- 4. 相册展开/收起 ----
    const toggleBtn = container.querySelector('[data-toggle="photo"]');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            const section = this.closest('.detail-section');
            const strip = section ? section.querySelector('.photo-strip') : null;
            if (!strip) return;
            const isExpanded = strip.classList.toggle('expanded');
            const total = strip.querySelectorAll('.photo-img').length;
            this.textContent = isExpanded ? '收起图片' : `展开所有图片（${total}）`;

            if (typeof options.onToggle === 'function') {
                options.onToggle();
            }
        });
    }

    // ---- 5. 面包屑点击 ----
    if (options.onBreadcrumbClick) {
        const links = container.querySelectorAll('.breadcrumb-link');
        links.forEach(link => {
            link.addEventListener('click', function(e) {
                e.stopPropagation();
                const targetId = this.dataset.nodeId;
                if (targetId && options.onBreadcrumbClick) {
                    options.onBreadcrumbClick(targetId);
                }
            });
        });
    }

    // ---- 6. 图片点击委托（灯箱） ----
    if (options.onPhotoClick) {
        // 移除旧委托（先移除再添加）
        container.removeEventListener('click', options.onPhotoClick);
        container.addEventListener('click', options.onPhotoClick);
    }

    // ---- 7. 图片加载 ----
    if (options.lazyLoadImages !== false) {
        loadImageRefs(container);
    }
}

// 对比模式辅助函数
window.toggleComparisonNode = function(node, buttonEl) {
    if (!node || !node.id) {
        console.warn('[toggleComparisonNode] invalid node');
        return false;
    }

    const id = node.id;
    const isCurrentlyInList = Comparison.hasNode(id);

    let success = false;
    let action = ''; // 'added' 或 'removed'

    if (isCurrentlyInList) {
        // 移出对比
        success = Comparison.removeNode(id);
        if (success) action = 'removed';
    } else {
        // 加入对比
        if (Comparison.isFull()) {
            toast('⚠️ 对比列表已满（最多 4 个）');
            return false;
        }
        success = Comparison.addNode(id);
        if (success) action = 'added';
    }

    if (success) {
        // 更新按钮文字
        if (buttonEl) {
            buttonEl.textContent = (action === 'added') ? '✓ 已加入对比' : '＋ 加入对比';
        }
        // 如果 Comparison View 当前是打开的，同步刷新视图
        if (Comparison.isOpen()) {
            Comparison.refresh();
        if (InteractionState.mode === 'quickSelect') {
            updateQuickSelectUI();
        }
        }
        updateComparisonEntry();
    }

    return success;
}

function updateComparisonEntry() {
    const btn = document.getElementById('comparisonEntryBtn');
    if (!btn) return;

    const count = Comparison.count();
    const isQuickSelect = InteractionState.mode === 'quickSelect';

    // 更新按钮文字：显示计数
    if (count === 0) {
        btn.textContent = '选择对比物种';
    } else {
        btn.textContent = `选择对比物种 (${count}/4)`;
    }

    // 如果处于快速选择模式，添加 active 类；否则移除
    if (isQuickSelect) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

function showSpeciesDetail(node) {
    if (!node) return;

    const modal = document.getElementById('speciesModal');
    const body = document.getElementById('speciesDetailBody');

    if (!modal || !body) {
        console.warn('[showSpeciesDetail] Modal or body container not found');
        return;
    }

    // ---- 1. 构建 HTML（纯函数，无副作用） ----
    const html = buildSpeciesDetailHTML(node, {
        showEditButton: true,           // 在 Species Modal 中显示编辑按钮
        showBreadcrumb: true,           // 显示面包屑
        showAlbumToggle: true,           // 相册多于 3 张时显示展开按钮
        showComparisonToggle: true
    });

    // ---- 2. 挂载内容（含事件绑定和图片加载） ----
    mountSpeciesDetailContent(body, html, {
        // 面包屑点击：关闭 Modal 并跳转
        onBreadcrumbClick: (targetId) => {
            const targetNode = findNodeById(Store.getTreeData(), targetId);
            if (targetNode) {
                closeSpeciesModal();
                jumpToNode(targetNode);
            }
        },
        // 图片点击委托（使用现有的 modalPhotoClickHandler）
        onPhotoClick: modalPhotoClickHandler,
        // 启用图片加载
        lazyLoadImages: true,
        // 启用异名折叠
        setupCollapse: true
    });

    // ---- 3. Modal 生命周期（仍由 showSpeciesDetail 控制） ----
    modal.classList.add('active');
}


function closeSpeciesModal() {
    document.getElementById('speciesModal').classList.remove('active');
}

function showContentDetail(node) {
    if (!node) return;
    showModal({
        title: '🗒︎ 笔记详情',
        fields: [],
        content: `
        <div style="padding:6px 0;line-height:1.8;">
            ${renderMarkdown(node.html || '')}
        </div>`,
        hideFooter: true,
        allowOverlayClose: true
    });
}

function bindRankCustomToggle(container) {
    if (!container) return;
    const selects = container.querySelectorAll('select[data-rank-name-field]');
    selects.forEach(select => {
        const targetId = select.dataset.rankNameField;
        const targetInput = document.getElementById(targetId);
        if (!targetInput) return;
        function toggle() {
            if (select.value === 'custom') {
                targetInput.style.display = 'block';
                targetInput.disabled = false;
            } else {
                targetInput.style.display = 'none';
                targetInput.disabled = true;
                targetInput.value = ''; // 清空自定义值
            }
        }
        select.addEventListener('change', toggle);
        toggle(); // 初始化
    });
}

// ============================================================
// 🖼 图片 HTML 生成工具（用于详情模态框）
// ============================================================

function createPhotoHTML(photo) {
    if (!photo) return '';
    const caption = escapeAttr(photo.caption || '');
    const altText = caption || '图片';
    
    if (photo.isImageRef && photo.uuid) {
        return `<img data-img-uuid="${escapeAttr(photo.uuid)}" data-caption="${caption}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="${altText}" />`;
    }
    
    if (photo.src) {
        const safeSrc = sanitizeUrl(photo.src, { allowDataImage: true });
        if (safeSrc) {
            return `<img src="${escapeAttr(safeSrc)}" data-src="${escapeAttr(safeSrc)}" data-caption="${caption}" alt="${altText}" />`;
        }
        // 不安全的 URL → 不生成 img
        return '';
    }
    return '';
}

// ============================================================
// 🖼 灯箱（使用 setImageBlob 管理 ObjectURL）
// ============================================================

/**
 * 打开灯箱（支持单张或多张图片）
 * @param {Array|Object|string} images - 图片数组 / 单张图片对象 / 图片URL字符串
 * @param {number|string} indexOrCaption - 索引（数组模式）或标题（单图模式）
 */
function openLightbox(images, indexOrCaption) {
    // ----- 重置旧 token（防止旧 Promise 干扰） -----
    const img = document.getElementById('lightboxImg');
    if (img) img._loadingToken = null;

    // ----- 兼容旧接口：单张图片 -----
    if (typeof images === 'string') {
        let caption = '';
        let index = 0;
        if (typeof indexOrCaption === 'string') {
            caption = indexOrCaption;
        } else if (typeof indexOrCaption === 'number') {
            index = indexOrCaption;
        }
        images = [{ src: images, caption }];
        indexOrCaption = 0;
    }

    // 确保是数组
    if (!Array.isArray(images)) {
        images = [images];
    }

    // 过滤掉无效图片
    const validImages = images.filter(img => img && (img.src || img.uuid));
    if (validImages.length === 0) {
        toast('❌ 没有可显示的图片');
        return;
    }

    // 确定当前索引
    let index = 0;
    if (typeof indexOrCaption === 'number' && indexOrCaption >= 0 && indexOrCaption < validImages.length) {
        index = indexOrCaption;
    }

    UIState.lightboxState.images = validImages;
    UIState.lightboxState.currentIndex = index;
    UIState.lightboxState.isOpen = true;

    // 显示灯箱
    const lb = document.getElementById('lightbox');
    lb.classList.add('active');

    // 渲染当前图片
    renderLightboxImage(index);
}

/**
 * 渲染灯箱中的指定图片
 */
function renderLightboxImage(index) {
    // ----- 如果灯箱已经关闭，直接返回 -----
    if (!UIState.lightboxState.isOpen) return;

    const img = document.getElementById('lightboxImg');
    const cap = document.getElementById('lightboxCaption');
    const images = UIState.lightboxState.images;

    if (!images || index < 0 || index >= images.length) {
        return;
    }

    // ----- 生成新的 token（用于竞态保护） -----
    const token = Symbol();
    img._loadingToken = token;

    const imageData = images[index];

    // 释放之前的 Blob URL
    if (UIState.currentLightboxBlobURL) {
        URL.revokeObjectURL(UIState.currentLightboxBlobURL);
        UIState.currentLightboxBlobURL = null;
    }

    // 重置图片状态
    img.onload = null;
    img.onerror = null;

    // 显示占位图（防止闪烁）
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    // ----- 更新页码和说明 -----
    const total = images.length;
    cap.innerHTML = total > 1 
        ? `📷︎ ${index + 1} / ${total}<br>${imageData.caption || ''}` 
        : (imageData.caption || '');

    // ----- 处理引用图片（从 IndexedDB 加载） -----
    if (imageData.isRef && imageData.uuid) {
        getImageFromDB(imageData.uuid)
            .then(blob => {
                // 竞态检查：灯箱是否仍打开 + token 是否匹配
                if (!UIState.lightboxState.isOpen || img._loadingToken !== token) return;
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    UIState.currentLightboxBlobURL = url;
                    img.src = url;
                } else {
                    img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect fill="%23f0f2f5" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" font-size="16" fill="%23999" text-anchor="middle" dy=".3em"%E5%9B%BE%E7%89%87%E4%B8%8D%E5%AD%98%E5%9C%A8%3C/text%3E%3C/svg%3E';
                    toast('⚠️ 图片数据已丢失');
                }
            })
            .catch(() => {
                if (!UIState.lightboxState.isOpen || img._loadingToken !== token) return;
                img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect fill="%23f0f2f5" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" font-size="16" fill="%23999" text-anchor="middle" dy=".3em"%E5%9B%BE%E7%89%87%E5%8A%A0%E8%BD%BD%E5%A4%B1%E8%B4%A5%3C/text%3E%3C/svg%3E';
                toast('⚠️ 图片加载失败');
            });
        return;
    }

    // ----- 处理普通图片（直接设置 src） -----
    if (imageData.src) {
        img.src = imageData.src;
    } else {
        img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect fill="%23f0f2f5" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" font-size="16" fill="%23999" text-anchor="middle" dy=".3em"%E6%97%A0%E6%95%88%E5%9B%BE%E7%89%87%3C/text%3E%3C/svg%3E';
    }
}

/**
 * 上一张（非循环）
 */
function prevImage() {
    const total = UIState.lightboxState.images.length;
    if (total <= 1) return;
    let newIndex = UIState.lightboxState.currentIndex - 1;
    if (newIndex < 0) {
        // 第一张，无动作
        return;
    }
    UIState.lightboxState.currentIndex = newIndex;
    renderLightboxImage(newIndex);
}

/**
 * 下一张（非循环）
 */
function nextImage() {
    const total = UIState.lightboxState.images.length;
    if (total <= 1) return;
    let newIndex = UIState.lightboxState.currentIndex + 1;
    if (newIndex >= total) {
        // 最后一张，无动作
        return;
    }
    UIState.lightboxState.currentIndex = newIndex;
    renderLightboxImage(newIndex);
}

/**
 * 关闭灯箱
 */
function closeLightbox() {
    const lb = document.getElementById('lightbox');
    lb.classList.remove('active');

    UIState.lightboxState.isOpen = false;

    const img = document.getElementById('lightboxImg');
    if (img) {
        img._loadingToken = null;
        img.onload = null;
        img.onerror = null;
    }

    if (UIState.currentLightboxBlobURL) {
        URL.revokeObjectURL(UIState.currentLightboxBlobURL);
        UIState.currentLightboxBlobURL = null;
    }

    // ---------- 清理状态 ----------
    UIState.lightboxState.images = [];
    UIState.lightboxState.currentIndex = 0;

    // ---------- 清空 caption ----------
    const cap = document.getElementById('lightboxCaption');
    if (cap) cap.textContent = '';
}

/**
 * 设置灯箱事件（关闭按钮、背景点击、图片翻页）
 */
function setupLightbox() {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    const closeBtn = document.getElementById('lightboxClose');

    // 关闭按钮
    closeBtn.addEventListener('click', closeLightbox);

    // 点击灯箱背景（非图片区域）关闭
    lb.addEventListener('click', function(e) {
        if (e.target === this) {
            closeLightbox();
        }
    });

    // ----- 🔥 核心：点击图片左右热区翻页（20% / 60% / 20%） -----
    img.addEventListener('click', function(e) {
        e.stopPropagation();

        const total = UIState.lightboxState.images.length;

        // 只有一张图：点击图片关闭灯箱
        if (total <= 1) {
            closeLightbox();
            return;
        }

        // 计算鼠标在图片上的相对位置
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;

        if (x < width * 0.25) {
            prevImage();
            return;
        }

        if (x > width * 0.75) {
            nextImage();
            return;
        }

    });
}

// ============================================================
// 🔥 灯箱事件委托处理函数（全局）
// ============================================================

async function modalPhotoClickHandler(e) {
    const img = e.target.closest('.photo-strip img');
    if (!img) return;
    e.stopPropagation();

    // 找到所在的 photo-strip 容器
    const strip = img.closest('.photo-strip');
    if (!strip) return;

    // 收集该 strip 中所有图片的数据，同时记录当前点击的索引
    const imageElements = strip.querySelectorAll('img');
    const validImages = [];
    let actualIndex = 0;

    for (let i = 0; i < imageElements.length; i++) {
        const el = imageElements[i];
        const uuid = el.dataset.imgUuid || '';
        const caption = el.dataset.caption || '';
        const src = el.dataset.src || el.src || '';

        let imageData = null;
        if (uuid) {
            // 引用图片（存储在 IndexedDB 中）
            imageData = {
                uuid: uuid,
                caption: caption,
                isRef: true,
                src: ''
            };
        } else if (src) {
            // 普通图片（URL 或 data:image）
            imageData = {
                src: src,
                caption: caption,
                isRef: false,
                uuid: ''
            };
        }

        if (imageData) {
            // 如果当前元素就是被点击的图片，记录它在 validImages 中的位置
            if (el === img) {
                actualIndex = validImages.length;
            }
            validImages.push(imageData);
        }
    }

    if (validImages.length === 0) {
        toast('❌ 没有可显示的图片');
        return;
    }

    // 如果 actualIndex 超出范围（理论上不会），置为 0
    if (actualIndex >= validImages.length) actualIndex = 0;

    // 打开灯箱
    openLightbox(validImages, actualIndex);
}

// ============================================================
// 🔍 搜索
// ============================================================

function rebuildSearchIndex() {
    UIState.allNodes = getAllNodes(Store.getTreeData());
}

function setupSearch() {
    const input = document.getElementById('searchInput');
    const suggestions = document.getElementById('searchSuggestions');

    function getSearchScore(match, query, node) {
        const text = (match.text || '').toLowerCase();
        let score = 0;

        if (text === query) score += 300;
        if (node.type === 'taxon') score += 100;

        switch (match.type) {
            case 'commonName': score += 80; break;
            case 'scientificName': score += 70; break;
            case 'author': score += 65; break;
            case 'synonym': score += 50; break;
            case 'distribution': score += 40; break;
            case 'habitat': score += 35; break;
            case 'phenology': score += 35; break;
            //case 'diagnosis': score += 10; break; 本版本禁用
            // case 'description': score += 30; break; 本版本禁用
            //case 'protologue': score += 20; break;
            //case 'typeInformation': score += 20; break;
            //case 'references': score += 20; break;
            // case 'discussion': score += 15; break; 本版本禁用
            //case 'ecology': score += 15; break;
            default: score += 10;
        }

        if (text.startsWith(query)) score += 30;
        return score;
    }

    input.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();
        if (!query) { suggestions.classList.remove('active'); return; }

        const matches = [];
        for (const item of UIState.allNodes) {
            const node = item.node;
            const profile = getProfileSafe(node);
            if (!profile) continue;

            const found = [];

            // ---- 高权重 ----
            // 中文名
            if (profile.commonName && profile.commonName.toLowerCase().includes(query)) {
                found.push({ type: 'commonName', text: profile.commonName });
            }
            // 学名
            if (profile.scientificName && profile.scientificName.toLowerCase().includes(query)) {
                found.push({ type: 'scientificName', text: profile.scientificName });
            }
            // 命名人
            if (profile.author && profile.author.toLowerCase().includes(query)) {
                found.push({ type: 'author', text: profile.author });
            }
            // 异名
            if (Array.isArray(profile.synonyms)) {
                for (const syn of profile.synonyms) {
                    if (syn.text && syn.text.toLowerCase().includes(query)) {
                        found.push({ type: 'synonym', text: syn.text });
                    }
                }
            }

            // ---- 中等权重 ----
            // 分布
            if (Array.isArray(profile.distribution) && profile.distribution.length) {
                const matchedItems = matchDistribution(profile.distribution, query);
                if (matchedItems.length) {
                    const displayText = matchedItems.map(formatDistributionItem).join('；');
                    found.push({ type: 'distribution', text: displayText });
                }
            }
            // 生境
            if (profile.habitat && profile.habitat.toLowerCase().includes(query)) {
                found.push({ type: 'habitat', text: profile.habitat });
            }
            // ---- phenology（按月份匹配） ----
            const phenologyItems = profile.phenology || [];
            if (phenologyItems.length) {
                // 尝试从 query 中提取数字（月份）
                const monthMatch = query.match(/(\d+)/);
                if (monthMatch) {
                    const monthNum = parseInt(monthMatch[1], 10);
                    if (monthNum >= 1 && monthNum <= 12) {
                        for (const item of phenologyItems) {
                            if (item.months && item.months.includes(monthNum)) {
                                found.push({ type: 'phenology', text: item.label + ': ' + item.value });
                            }
                        }
                    }
                }
                // 可选：如果 query 包含“全年”也匹配全年
                if (query.includes('全年')) {
                    for (const item of phenologyItems) {
                        if (item.months && item.months.length === 12) {
                            found.push({ type: 'phenology', text: item.label + ': ' + item.value });
                        }
                    }
                }
            }

            // ---- 低权重 ----
            // 原始发表
            //if (profile.protologue && profile.protologue.text && profile.protologue.text.toLowerCase().includes(query)) {
            //    found.push({ type: 'protologue', text: profile.protologue.text });
            //}
            // 模式信息
            //if (profile.typeInformation && profile.typeInformation.text && profile.typeInformation.text.toLowerCase().includes(query)) {
            //    found.push({ type: 'typeInformation', text: profile.typeInformation.text });
            //}
            // 参考文献
            //if (Array.isArray(profile.references)) {
            //    for (const ref of profile.references) {
            //        if (ref.text && ref.text.toLowerCase().includes(query)) {
            //            found.push({ type: 'references', text: ref.text });
            //        }
            //    }
            //}
            // 鉴定要点  已禁用
            //if (profile.diagnosis && profile.diagnosis.toLowerCase().includes(query)) {
            //    found.push({ type: 'diagnosis', text: profile.diagnosis });
            //}
            // 描述 已禁用
            //if (profile.description && profile.description.toLowerCase().includes(query)) {
            //    found.push({ type: 'description', text: profile.description });
            //}
            // 讨论
            //if (profile.discussion && profile.discussion.toLowerCase().includes(query)) {
            //    found.push({ type: 'discussion', text: profile.discussion });
            //}

            // 如果有匹配，计算最佳分数
            if (found.length > 0) {
                let bestScore = -Infinity;
                for (const m of found) {
                    const score = getSearchScore(m, query, node);
                    if (score > bestScore) bestScore = score;
                }
                matches.push({
                    node: node,
                    matches: found,
                    score: bestScore
                });
            }
        }

        // 排序
        matches.sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return getDisplayName(a.node).localeCompare(getDisplayName(b.node));
        });

        // 渲染建议
        if (matches.length === 0) {
            suggestions.innerHTML = '<div class="suggestion-item" style="color:#888;">无匹配结果</div>';
        } else {
            let html = '';
            const maxShow = Math.min(matches.length, 25);
            for (let i = 0; i < maxShow; i++) {
                const { node, matches: matchList } = matches[i];
                const profile = getProfileSafe(node);
                const commonName = profile.commonName || '';
                const sciName = profile.scientificName || '';
                const author = profile.author || '';
                const displayName = commonName || node.name || '未命名';
                const latinDisplay = formatScientificNameWithAuthor(sciName, author);
                const typeLabel = getTypeLabel(node);
                const badgeClass = isSpeciesNode(node) ? 'species' : 'taxon';

                // ---- 构建匹配提示 ----
                let extraHtml = '';
                const typeMap = {
                    'synonym': '异名',
                    'distribution': '分布',
                    'habitat': '生境',
                    //'diagnosis': '鉴定要点',
                    //'description': '描述',
                    //'protologue': '原始发表',
                    //'typeInformation': '模式信息',
                    //'references': '参考文献',
                    //'discussion': '讨论',
                    'phenology': '物候'
                };
                for (const m of matchList) {
                    // 跳过中文名、学名、命名人（主标题和副标题已显示）
                    if (m.type === 'commonName' || m.type === 'scientificName' || m.type === 'author') continue;
                    const label = typeMap[m.type] || m.type;
                        let displayText = m.text;
                        if (m.type === 'synonym') {
                            displayText = formatScientificNameText(m.text);
                        }
                    extraHtml += `
                        <div class="search-match-hint">
                            <span class="synonym-icon">[${label}]</span> ${displayText}
                        </div>
                    `;
                }

                html += `
                    <div class="suggestion-item" data-node-id="${node.id}">
                        <span>
                            ${displayName}
                            ${latinDisplay ? `<span class="search-latin">${latinDisplay}</span>` : ''}
                            ${extraHtml}
                        </span>
                        <span class="badge ${badgeClass}">${typeLabel}</span>
                    </div>
                `;
            }
            suggestions.innerHTML = html;
        }

        suggestions.classList.add('active');
    });

    // 点击建议跳转
    suggestions.addEventListener('click', function(e) {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        const nodeId = item.dataset.nodeId;
        const node = findNodeById(Store.getTreeData(), nodeId);
        if (!node) return;
        suggestions.classList.remove('active');
        input.value = '';
        jumpToNode(node);
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-container')) suggestions.classList.remove('active');
    });
}

function expandPath(nodeId) {
    const node = findNodeById(Store.getTreeData(), nodeId);
    if (!node) return;
    const path = [];
    let current = node;
    while (current) {
        path.unshift(current);
        const parent = findParent(Store.getTreeData(), current.id);
        current = parent;
    }
    for (let n of path) {
        if (n.type === 'taxon' && n.children && n.children.length) {
            const li = document.querySelector(`li[data-node-id="${n.id}"]`);
            if (li) {
                const cd = li.querySelector(':scope > .children-container');
                const lb = li.querySelector(':scope > .node-label');
                if (cd && !cd.classList.contains('open')) { cd.classList.add('open'); if (lb) lb.classList.add(
                        'expanded'); }
            }
        }
    }
    const targetLi = document.querySelector(`li[data-node-id="${nodeId}"]`);
    if (targetLi) {
        targetLi.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function selectNode(node) {
    Store.setSelectedNode(node);
    document.querySelectorAll('.node-label').forEach(el => el.classList.remove('selected'));
    const li = document.querySelector(`li[data-node-id="${node.id}"]`);
    if (li) { const lb = li.querySelector('.node-label'); if (lb) lb.classList.add('selected'); }
}

function selectNodeById(id) {
    const node = findNodeById(Store.getTreeData(), id);
    if (node) selectNode(node);
    return node;
}

function jumpToNode(node) {
    if (!node) return;

    expandPath(node.id);
    selectNode(node);
    
    if (isSpeciesNode(node)) {
        showSpeciesDetail(node);
    } else if (node.type === 'content') {
        showContentDetail(node);
    } else {
        showTaxonContent(node);
    }

    highlightNode(node.id);
}

function highlightNode(id) {
    if (UIState.highlightTimer) {
        clearTimeout(UIState.highlightTimer);
    }

    document.querySelectorAll('.node-label.highlight')
        .forEach(el => el.classList.remove('highlight'));

    const li = document.querySelector(`li[data-node-id="${id}"]`);
    const lb = li?.querySelector('.node-label');

    if (lb) {
        lb.classList.add('highlight');

        UIState.highlightTimer = setTimeout(() => {
            lb.classList.remove('highlight');
            UIState.highlightTimer = null;
        }, 2000);
    }
}

// ==============================================
// 衬线模式
// ==============================================

function toggleFont() {
    const body = document.body;
    body.classList.toggle('serif-mode');
    updateFontToggleUI();   // 更新按钮文字
    localStorage.setItem('fontMode', body.classList.contains('serif-mode') ? 'serif' : 'sans');
}

function applyFontPreference() {
    const saved = localStorage.getItem('fontMode');
    if (saved === 'serif') {
        document.body.classList.add('serif-mode');
    } else {
        document.body.classList.remove('serif-mode');
    }
}

function updateFontToggleUI() {
    const btn = document.getElementById('fontToggleBtn');
    if (!btn) return;
    const isSerif = document.body.classList.contains('serif-mode');
    btn.textContent = isSerif ? '☑ 衬线阅读模式' : '☐ 衬线阅读模式';
}

// ============================================================
// ✏️ 编辑模式
// ============================================================

function toggleEditMode() {
    UIState.isEditMode = !UIState.isEditMode;
    const btn = document.getElementById('editToggleBtn');
    if (UIState.isEditMode) {
        btn.classList.add('active');
        btn.textContent = '☑ 编辑模式';
        document.body.classList.add('edit-mode');
        localStorage.setItem('editMode', 'true');
    } else {
        btn.classList.remove('active');
        btn.textContent = '✎ 编辑模式';
        document.body.classList.remove('edit-mode');
        localStorage.setItem('editMode', 'false');
    }
    UIState.treeSortableInstances.forEach(s => s.option('disabled', !UIState.isEditMode));
    updateEditButtons();
    const sel = Store.getSelectedNode();
    if (sel) showTaxonContent(sel);
}

function updateEditButtons() {
    document.querySelectorAll('.node-actions').forEach(el => {
        el.style.display = UIState.isEditMode ? 'flex' : 'none';
    });
    document.querySelectorAll('.card-actions').forEach(el => {
        el.style.display = UIState.isEditMode ? 'flex' : 'none';
    });
    const addBtns = document.querySelectorAll('.add-btns');
    addBtns.forEach(el => { el.style.display = UIState.isEditMode ? 'flex' : 'none'; });
}

// ============================================================
// 📐 左栏宽度拖拽
// ============================================================

function setupSidebarResizer() {
    const resizer = document.getElementById('sidebarResizer');
    const sidebar = document.getElementById('sidebar');
    let isResizing = false;

    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        resizer.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', onResizeEnd);
        e.preventDefault();
    });

    function onResize(e) {
        if (!isResizing) return;
        const rect = sidebar.getBoundingClientRect();
        const newWidth = e.clientX - rect.left;
        if (newWidth >= 180 && newWidth <= 600) {
            sidebar.style.width = newWidth + 'px';
            document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        }
    }

    function onResizeEnd() {
        isResizing = false;
        resizer.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', onResizeEnd);
        const w = sidebar.style.width;
        if (w) localStorage.setItem('sidebarWidth', w);
    }

    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        const w = parseInt(savedWidth);
        if (w >= 180 && w <= 600) {
            sidebar.style.width = w + 'px';
            document.documentElement.style.setProperty('--sidebar-width', w + 'px');
        }
    }
}

// ============================================================
// 📋 剪贴板粘贴图片（存入 IndexedDB）
// ============================================================

async function pasteImageFromClipboard(textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;

    try {
        if (!navigator.clipboard || !navigator.clipboard.read) {
            toast('❌ 当前浏览器不支持剪贴板读取，请使用文件选择或URL');
            return;
        }
        const items = await navigator.clipboard.read();
        let imageBlob = null;
        for (let item of items) {
            if (item.types.some(t => t.startsWith('image/'))) {
                const type = item.types.find(t => t.startsWith('image/'));
                imageBlob = await item.getType(type);
                break;
            }
        }
        if (!imageBlob) {
            toast('❌ 剪贴板中没有图片数据');
            return;
        }

        const compressedBlob = await compressImage(imageBlob, 1024, 0.8);
        const uuid = generateUUID();
        await saveImageToDB(uuid, compressedBlob);

        const current = textarea.value;
        const newLine = current ? '\n' : '';
        textarea.value = current + newLine + `[img:${uuid}]|粘贴图片（压缩后）`;
        textarea.dispatchEvent(new Event('input'));
        toast('✅ 图片已存入 IndexedDB，请添加说明文字');
    } catch (err) {
        console.error(err);
        toast('❌ 读取剪贴板失败: ' + err.message);
    }
}

// 本地图片上传

async function handleImageUpload(textareaId, files) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;

    // 转换为数组，防止后续修改（如 input.value 重置）
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const total = fileArray.length;
    let successCount = 0;
    let failCount = 0;
    const lines = [];

    toast(`⏫ 正在处理 ${total} 张图片...`);

    for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        try {
            // 类型检查
            if (!file.type.startsWith('image/')) {
                console.warn(`跳过非图片文件: ${file.name}`);
                failCount++;
                continue;
            }

            let blob = file;
            const sizeMB = file.size / (1024 * 1024);

            if (sizeMB > 30) {
                toast(`❌ 文件 "${file.name}" 超过 30MB，已跳过`);
                failCount++;
                continue;
            } else if (sizeMB > 10) {
                toast(`⏳ 文件 "${file.name}" 较大 (${sizeMB.toFixed(1)}MB)，正在压缩...`);
                blob = await compressImage(file, 1024, 0.8);
                // 压缩后仍可能较大，但不再二次检查
            }

            const uuid = generateUUID();
            await saveImageToDB(uuid, blob);

            // caption 保留原始文件名
            lines.push(`[img:${uuid}]|${file.name}`);
            successCount++;
        } catch (err) {
            console.error(`处理文件 "${file.name}" 失败:`, err);
            failCount++;
        }
    }

    // 追加到文本域
    if (lines.length > 0) {
        const current = textarea.value;
        const newLines = lines.join('\n');
        textarea.value = current ? current + '\n' + newLines : newLines;
        textarea.dispatchEvent(new Event('input'));
    }

    // 显示最终结果
    if (successCount > 0 && failCount === 0) {
        toast(`✅ 成功上传 ${successCount} 张图片`);
    } else if (successCount > 0 && failCount > 0) {
        toast(`⚠️ 上传完成：成功 ${successCount} 张，失败 ${failCount} 张`);
    } else {
        toast(`❌ 上传失败，未添加任何图片`);
    }
}

function bindImageUploadEvents(container) {
    if (!container) return;

    // 文件输入框的 change 事件
    const fileInputs = container.querySelectorAll('input[type="file"][data-upload-target]');
    fileInputs.forEach(input => {
        input.addEventListener('change', function(e) {
            const targetId = this.dataset.uploadTarget;
            if (!targetId) return;
            const files = this.files;
            if (files && files.length > 0) {
                handleImageUpload(targetId, files);
            }
            this.value = ''; // 重置以允许重复选择同一文件
        });
    });

    // 上传按钮的点击事件（触发 file input）
    const buttons = container.querySelectorAll('button[data-upload-button]');
    buttons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            const inputId = this.dataset.uploadButton;
            if (inputId) {
                const input = document.getElementById(inputId);
                if (input) input.click();
            }
        });
    });
}

// ============================================================
// 🖼 图片引用加载器（从 IndexedDB 加载，使用 setImageBlob）
// ============================================================

async function loadImageRefs(container) {
    container = container || document;
    const elements = container.querySelectorAll('[data-img-uuid]');

    await Promise.all(Array.from(elements).map(async (el) => {
        const uuid = el.dataset.imgUuid;
        if (el._blobURL && el.src && el.src.startsWith('blob:')) {
            return;
        }

        const token = uuid;
        el.dataset.loadingUuid = token;

        try {
            const blob = await getImageFromDB(uuid);

            if (el.dataset.loadingUuid !== token) return;
            if (!el.isConnected) {
                if (el._blobURL) {
                    URL.revokeObjectURL(el._blobURL);
                    el._blobURL = null;
                }
                return;
            }

            if (blob) {
                setImageBlob(el, blob);
            } else {
                setImageBlob(el, null);
            }
        } catch (e) {
            if (el.dataset.loadingUuid === token && el.isConnected) {
                setImageBlob(el, null);
            }
        }
    }));
}

// ============================================================
// 📢 Toast（支持样式扩展）
// ============================================================

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    el.classList.remove('warning', 'info');
    clearTimeout(UIState.toastTimer);
    UIState.toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ============================================================
// ➕ 添加功能（含数据验证）
// ============================================================

function showAddTaxonModal(parent) {
    if (!parent) return;
    if (isSpeciesNode(parent)) {
        toast('⚠️ 物种节点不能添加子分类');
        return;
    }
    showModal({
        title: '添加子分类群',
        fields: [
            { id: 'name', label: '分类群名称 *', type: 'text', placeholder: '例如：蔷薇科' },
            { 
                id: 'rank', 
                label: '分类阶元', 
                type: 'select', 
                value: '', 
                rankNameField: 'rankName',   // 关联自定义输入框
                options: [
                    { value: '', label: '未设置' },
                    { value: 'domain', label: '域 Domain' },
                    { value: 'kingdom', label: '界 Kingdom' },
                    { value: 'phylum', label: '门 Phylum' },
                    { value: 'class', label: '纲 Class' },
                    { value: 'order', label: '目 Order' },
                    { value: 'family', label: '科 Family' },
                    { value: 'genus', label: '属 Genus' },
                    { value: 'custom', label: '其他分类阶元' }
                ]
            },
            { 
                id: 'rankName', 
                label: '自定义阶元名称', 
                type: 'text', 
                value: '',
                placeholder: '例如：亚属，组，系，复合群，clade …',
                hidden: true   // 初始隐藏
            },
            { 
                id: 'photos', 
                label: '图片（每行一张，格式：URL|说明 或 [img:uuid]|说明）', 
                type: 'textarea', 
                placeholder: 'https://example.com/photo.jpg|栖息地照片', 
                rows: 2, 
                withPaste: true, 
                isImageField: true 
            }
        ],
        onSave: function(data) {
            const result = validateTaxonName(parent, data.name);
            if (!result.valid) { toast(result.message); return false; }
            const photos = parseImageField(data.photos);
            const rank = data.rank || '';
            // 仅当 rank 为 'custom' 时保存 rankName，否则清空
            const rankName = (rank === 'custom') ? data.rankName.trim() : '';
            const newNode = {
                id: generateId(),
                name: data.name.trim(),
                rank: rank,
                rankName: rankName,
                type: 'taxon',
                children: [],
                photos: photos
            };
            if (!parent.children) parent.children = [];
            ensureTaxonProfile(newNode)
            parent.children.push(newNode);
            saveAndRefresh();
            toast('✅ 已添加分类群: ' + data.name.trim());
            expandPath(parent.id);
            selectNode(parent);
            showTaxonContent(parent);
            return true;
        }
    });
}

function showAddSpeciesModal(parent) {
    if (!parent) return;
    showModal({
        title: '添加物种',
        fields: [
            // ===== 分组：分类学信息 =====
            { type: 'group-start', label: '分类学信息' },
            { 
                id: 'rank', 
                label: '等级', 
                type: 'select', 
                value: 'species',
                options: [
                    { value: 'species', label: '物种 Species' },
                    { value: 'nothospecies', label: '杂交种 Nothospecies' },
                    { value: 'subspecies', label: '亚种 Subspecies' },
                    { value: 'variety', label: '变种 Variety' },
                    { value: 'form', label: '变型 Form' },
                    { value: 'cultivar', label: '栽培品种 Cultivar' }
                ]
            },
            { id: 'commonName', label: '中文俗名', type: 'text', placeholder: '例如：香茜' },
            { id: 'scientificNameRaw', label: '学名（带命名人）', type: 'text', placeholder: '例如：Carlemannia tetragona Hook. f.' },
            { 
                id: 'synonyms', 
                label: '异名 （格式：异名|链接，每行一条）', 
                type: 'textarea', 
                placeholder: '例如：Carlemannia henryi H.Lév.|https://example.com', 
                rows: 3 
            },
            { id: 'protologue', label: '原始发表 （格式：文献信息|链接）', type: 'text', placeholder: '例如：The Flora of British India 3(7): 85. 1880.|https://example.com', inline: true },
            { id: 'typeInformation', label: '模式信息 （格式：标本信息|链接）', type: 'text', placeholder: '例如：Griffith (Kew Distrib. 2841)|https://example.com', inline: true },
            {
                id: 'specimens',
                label: '标本（格式：标本信息|链接,每行一条）',
                type: 'textarea',
                placeholder: '例如：\nK000123456|https://example.org/specimen/K000123456\nK000123457',
                rows: 3
            },
            { type: 'group-end' },

            // ===== 分组：生态与分布 =====
            { type: 'group-start', label: '生态与分布' },
            { id: 'distribution', label: '分布 （格式：国家（地区1，地区2，…），各国家间用换行、逗号或分号分隔）', type: 'textarea', placeholder: '例如：中国（云南，西藏）；印度东北部；缅甸；泰国；越南；苏门答腊', rows: 3 },
            { id: 'habitat', label: '生境', type: 'text', placeholder: '例如：海拔850-1500米处的密林中，尤以潮湿沟谷常见', inline: true},
            {
                id: 'phenology',
                label: '物候信息',
                type: 'textarea',
                placeholder: '例如：花期7-9月，果期10-12月',
                rows: 1,
                inline: true
            },
            { id: 'localities', label: '点位记录 （格式：坐标|描述，每行一条）', type: 'textarea', placeholder: '例如：22°30′N 101°30′E|云南普洱某县某镇林中水边', rows: 2 },
            { type: 'group-end' },

            // ===== 分组：相册 =====
            { type: 'group-start', label: '相册' },
            { id: 'photos', label: '图片（每行一张，格式：URL|说明 或 [img:uuid]|说明）', type: 'textarea', placeholder: '例如：https://example.com/photo.jpg|花序，示小苞片', rows: 3, withPaste: true, isImageField: true },
            { type: 'group-end' },

            // ===== 分组：形态与讨论 =====
            { type: 'group-start', label: '形态与讨论' },
            { id: 'diagnosis', label: '鉴定要点（支持Markdown）', type: 'textarea', placeholder: '鉴定特征', rows: 2 },
            { id: 'description', label: '物种描述（支持Markdown）', type: 'textarea', placeholder: '详细描述', rows: 16 },
            { id: 'sentenceBreak', label: '中文句号后自动换行', type: 'checkbox' },
            { id: 'structCheck', label: '结构化整理描述', type: 'checkbox' },
            { id: 'etymology', label: '词源（支持Markdown）', type: 'textarea', placeholder: '词源说明', rows: 2 },
            { id: 'discussion', label: '讨论（支持Markdown）', type: 'textarea', placeholder: '可记录争议、备注等', rows: 3 },
            { type: 'group-end' },

            // ===== 分组：参考文献 =====
            { type: 'group-start', label: '参考文献' },
            { id: 'references', label: '参考文献 （格式：文献信息|链接，每行一条）', type: 'textarea', placeholder: '例如：中国科学院中国植物志编辑委员会. 中国植物志: 第71卷 第1分册[M]. 北京: 科学出版社|https://example.com', rows: 3 },
            { type: 'group-end' }
        ],
        onSave: function(formData) {                       // 参数名改为 formData
            const rawInput = formData.scientificNameRaw.trim();
            const parsed = parseScientificName(rawInput);
            const commonName = formData.commonName.trim();

            if (!commonName && !parsed.scientificName) {
                toast('⚠️ 请至少填写中文俗名或学名');
                return false;
            }

            const result = validateSpeciesName(parent, commonName, parsed.scientificName);
            if (!result.valid) {
                toast(result.message);
                return false;
            }

            if (parsed.confidence === 'low') {
                toast('⚠️ 学名格式不常见，请确认是否正确。');
            } else if (parsed.confidence === 'medium' && !parsed.parsed) {
                toast('ℹ️ 未检测到命名人，将仅保存学名主体。');
            }

            // ----- 1. 解析图片（UI 特有） -----
            const photos = parseImageField(formData.photos || '');

            // ----- 2. 构造标准化数据对象（使用 formData，变量名改用 dataObj） -----
            const dataObj = {
                scientificNameRaw: rawInput,
                commonName: commonName,
                rank: formData.rank || 'species',           // 下拉框值，默认为 species
                distribution: parseDistributionText(formData.distribution || ''),
                habitat: (formData.habitat || '').trim(),
                phenology: parsePhenologyText(formData.phenology || ''),
                localities: (formData.localities || '').split('\n').filter(s => s.trim()).map(line => {
                    const parts = line.split('|');
                    return { coordinate: parts[0]?.trim() || '', description: parts[1]?.trim() || '' };
                }),
                protologue: parseAnnotatedText(formData.protologue || ''),
                typeInformation: parseAnnotatedText(formData.typeInformation || ''),
                specimens: (formData.specimens || '').split('\n').filter(s => s.trim()).map(parseAnnotatedText),
                references: (formData.references || '').split('\n').filter(s => s.trim()).map(parseAnnotatedText),
                synonyms: (formData.synonyms || '').split('\n').filter(s => s.trim()).map(parseAnnotatedText),
                diagnosis: (formData.diagnosis || '').trim(),
                description: (formData.description || '').trim(),
                etymology: (formData.etymology || '').trim(),
                discussion: (formData.discussion || '').trim()
            };

            // ----- 3. 调用共享创建函数 -----
            try {
                const newNode = createSpeciesNode(parent, dataObj);
                // 手动补充 photos（因为 createSpeciesNode 目前未处理 photos）
                if (newNode && photos && photos.length) {
                    newNode.photos = photos;
                }
                saveAndRefresh();
                toast('✅ 已添加物种: ' + (commonName || parsed.scientificName));
                expandPath(parent.id);
                selectNode(parent);
                showTaxonContent(parent);
                return true;
            } catch (err) {
                toast('❌ 创建失败: ' + err.message);
                return false;
            }
        }
    });
}

function showAddContentModal(parent) {
    if (!parent) return;
    showModal({
        title: '添加笔记',
        fields: [
            { id: 'html', label: '内容（支持HTML / Markdown）', type: 'textarea', placeholder: '输入笔记内容...', rows: 5 }
        ],
        onSave: function(data) {
            const html = data.html.trim();
            if (!html) { toast('请输入内容'); return false; }
            const newNode = { id: generateId(), type: 'content', html: html };
            if (!parent.children) parent.children = [];
            parent.children.push(newNode);
            saveAndRefresh();
            toast('✅ 已添加笔记');
            expandPath(parent.id);
            selectNode(parent);
            showTaxonContent(parent);
            return true;
        }
    });
}

// ============================================================
// ✏️ 编辑功能（含数据验证）
// ============================================================

function openEditor(node) {
    if (!node) return;
    if (node.type === 'content') {
        editContent(node);
    } else if (isSpeciesNode(node)) {
        editSpecies(node);
    } else {
        editTaxon(node);
    }
}

function editTaxon(node) {
    const parent = findParent(Store.getTreeData(), node.id);
    if (!parent) { toast('❌ 找不到父节点'); return; }
    const photosStr = (node.photos || []).map(p => {
        if (p.isImageRef && p.uuid) return `[img:${p.uuid}]|${p.caption || ''}`;
        return p.src + '|' + (p.caption || '');
    }).join('\n');
    showModal({
        title: '编辑分类群',
        fields: [
            { id: 'name', label: '分类群名称 *', type: 'text', value: node.name || '' },
            { 
                id: 'rank', 
                label: '分类阶元', 
                type: 'select', 
                value: node.rank || '', 
                rankNameField: 'rankName',
                options: [
                    { value: '', label: '未设置' },
                    { value: 'domain', label: '域 Domain' },
                    { value: 'kingdom', label: '界 Kingdom' },
                    { value: 'phylum', label: '门 Phylum' },
                    { value: 'class', label: '纲 Class' },
                    { value: 'order', label: '目 Order' },
                    { value: 'family', label: '科 Family' },
                    { value: 'genus', label: '属 Genus' },
                    { value: 'custom', label: '其他分类阶元' }
                ]
            },
            { 
                id: 'rankName', 
                label: '自定义阶元名称', 
                type: 'text', 
                value: node.rankName || '',
                placeholder: '例如：亚属，组，系，复合群，clade …',
                hidden: true
            },
            { 
                id: 'photos', 
                label: '图片（每行一张，格式：URL|说明 或 [img:uuid]|说明）', 
                type: 'textarea', 
                value: photosStr, 
                rows: 2, 
                withPaste: true, 
                isImageField: true 
            }
        ],
        onSave: function(data) {
            const result = validateTaxonName(parent, data.name, node.id);
            if (!result.valid) { toast(result.message); return false; }
            const rank = data.rank || '';
            const rankName = (rank === 'custom') ? data.rankName.trim() : '';
            node.name = data.name.trim();
            node.rank = rank;
            node.rankName = rankName;
            node.photos = parseImageField(data.photos);
            saveAndRefresh();
            toast('✅ 已更新分类群');
            const sel = Store.getSelectedNode();
            if (sel && sel.id === node.id) showTaxonContent(node);
            else if (sel) showTaxonContent(sel);
            return true;
        }
    });
}

function editSpecies(node) {
    const parent = findParent(Store.getTreeData(), node.id);
    if (!parent) { toast('❌ 找不到父节点'); return; }

    const profile = getProfileSafe(node);

    // 字段初始值
    const commonName = profile.commonName || node.commonName || '';
    const distribution = (profile.distribution && profile.distribution.length) 
        ? profile.distribution 
        : (node.distribution || []);
    const habitat = profile.habitat || node.habitat || '';
    const phenology = (profile.phenology && profile.phenology.length) 
        ? profile.phenology 
        : (node.phenology || []);
    const localities = (profile.localities && profile.localities.length) 
        ? profile.localities 
        : (node.localities || []);
    const synonyms = (profile.synonyms && profile.synonyms.length) 
        ? profile.synonyms 
        : (node.synonyms || []);
    const specimens = (profile.specimens && profile.specimens.length) 
        ? profile.specimens 
        : (node.specimens || []);
    const protologueFallback = (profile.protologue?.text || profile.protologue?.link) 
        ? profile.protologue 
        : (node.protologue || { text: '', link: '' });
    const typeInfoFallback = (profile.typeInformation?.text || profile.typeInformation?.link) 
        ? profile.typeInformation 
        : (node.typeInformation || { text: '', link: '' });
    const references = (profile.references && profile.references.length) 
        ? profile.references 
        : (node.references || []);
    const diagnosis = profile.diagnosis || node.diagnosis || '';
    const description = profile.description || node.description || '';
    const etymology = profile.etymology || node.etymology || '';
    const discussion = profile.discussion || node.discussion || '';

    // scientificNameRaw 优先 node（旧数据），否则组合
    let rawDisplay = node.scientificNameRaw || 
                    ((profile.scientificName || node.scientificName || '') + 
                    (profile.author || node.author ? ' ' + (profile.author || node.author) : ''));

    const photosStr = (node.photos || []).map(p => {
        if (p.isImageRef && p.uuid) return `[img:${p.uuid}]|${p.caption || ''}`;
        return p.src + '|' + (p.caption || '');
    }).join('\n');

    showModal({
        title: '编辑物种',
        fields: [
            // ===== 分组：分类学信息 =====
            { type: 'group-start', label: '分类学信息' },
            { 
                id: 'rank', 
                label: '等级', 
                type: 'select', 
                value: node.rank || 'species',
                options: [
                    { value: 'species', label: '物种 Species' },
                    { value: 'nothospecies', label: '杂交种 Nothospecies' },
                    { value: 'subspecies', label: '亚种 Subspecies' },
                    { value: 'variety', label: '变种 Variety' },
                    { value: 'form', label: '变型 Form' },
                    { value: 'cultivar', label: '栽培品种 Cultivar' }
                ]
            },
            { id: 'commonName', label: '中文俗名', type: 'text', value: commonName },
            { id: 'scientificNameRaw', label: '学名（带命名人）', type: 'text', value: rawDisplay },
            { 
                id: 'synonyms', 
                label: '异名 （格式：异名|链接，每行一条）', 
                type: 'textarea', 
                value: synonyms.map(s =>
                    s.text + (s.link ? '|' + s.link : '')
                ).join('\n'), 
                rows: 3 
            },
            { 
                id: 'protologue', 
                label: '原始发表 （格式：文献信息|链接）', 
                type: 'text', 
                value: (protologueFallback.text || '') + (protologueFallback.link ? '|' + protologueFallback.link : ''),  
                inline: true
            },
            { 
                id: 'typeInformation', 
                label: '模式信息 （格式：标本信息|链接）', 
                type: 'text', 
                value: (typeInfoFallback.text || '') + (typeInfoFallback.link ? '|' + typeInfoFallback.link : ''),
                inline: true
            },
            {
                id: 'specimens',
                label: '标本（格式：标本信息|链接，每行一条）',
                type: 'textarea',
                value: specimens.map(s => s.text + (s.link ? '|' + s.link : '')).join('\n'),
                rows: 3
            },
            { type: 'group-end' },

            // ===== 分组：生态与分布 =====
            { type: 'group-start', label: '生态与分布' },
            { 
                id: 'distribution', 
                label: '分布 （格式：国家（地区1，地区2，…），各国家间用换行、逗号或分号分隔）', 
                type: 'textarea', 
                value: distribution.map(d =>
                    d.areas.length ? `${d.country}（${d.areas.join('，')}）` : d.country
                ).join('；') 
            },
            { id: 'habitat', label: '生境', type: 'text', value: habitat, inline: true },
            { 
                id: 'phenology', 
                label: '物候信息', 
                type: 'textarea', 
                value: phenology.map(p => `${p.label}${p.value}`).join('，'), 
                rows: 1,
                inline: true
            },
            { 
                id: 'localities', 
                label: '点位记录 （格式：坐标|描述，每行一条）', 
                type: 'textarea', 
                value: localities.map(l => 
                    `${l.coordinate}|${l.description}`
                ).join('\n'), 
                rows: 2 
            },
            { type: 'group-end' },

            // ===== 分组：相册 =====
            { type: 'group-start', label: '相册' },
            { id: 'photos', label: '图片（每行一张，格式：URL|说明 或 [img:uuid]|说明）', type: 'textarea', value: photosStr, rows: 3, withPaste: true, isImageField: true },
            { type: 'group-end' },

            // ===== 分组：形态与讨论 =====
            { type: 'group-start', label: '形态与讨论' },
            { id: 'diagnosis', label: '鉴定要点（支持Markdown）', type: 'textarea', value: diagnosis, rows: 2 },
            { id: 'description', label: '物种描述（支持Markdown）', type: 'textarea', value: description, rows: 16 },
            { id: 'sentenceBreak', label: '中文句号后自动换行', type: 'checkbox' },
            { id: 'structCheck', label: '结构化整理描述', type: 'checkbox' },
            { id: 'etymology', label: '词源（支持Markdown）', type: 'textarea', value: etymology, rows: 2 },
            { id: 'discussion', label: '讨论（支持Markdown）', type: 'textarea', value: discussion, rows: 3 },
            { type: 'group-end' },

            // ===== 分组：参考文献 =====
            { type: 'group-start', label: '参考文献' },
            { 
                id: 'references', 
                label: '参考文献 （格式：文献信息|链接，每行一条）', 
                type: 'textarea', 
                value: (profile.references || []).map(r => 
                    r.text + (r.link ? '|' + r.link : '')
                ).join('\n'), 
                rows: 3 
            },
            { type: 'group-end' }
        ],
        onSave: function(data) {
            const rawInput = data.scientificNameRaw.trim();
            const parsed = parseScientificName(rawInput);
            const commonName = data.commonName.trim();

            if (!commonName && !parsed.scientificName) {
                toast('⚠️ 请至少填写中文俗名或学名');
                return false;
            }

            // 唯一性检查
            const result = validateSpeciesName(parent, commonName, parsed.scientificName, node.id);
            if (!result.valid) { toast(result.message); return false; }

            // 更新树结构字段
            node.rank = data.rank;
            node.rankName = '';
            node.photos = parseImageField(data.photos);
            node.name = commonName || parsed.scientificName || '未命名物种';

            // 写入 profile
            const profile = ensureTaxonProfile(node);
            profile.scientificNameRaw = rawInput;
            profile.scientificName = parsed.scientificName;
            profile.author = parsed.author;
            profile.commonName = commonName;
            profile.distribution = parseDistributionText(data.distribution);
            profile.habitat = data.habitat.trim();
            profile.phenology = parsePhenologyText(data.phenology);
            profile.protologue = parseAnnotatedText(data.protologue);
            profile.typeInformation = parseAnnotatedText(data.typeInformation);
            profile.specimens = data.specimens.split('\n') .filter(s => s.trim()) .map(parseAnnotatedText);
            profile.references = data.references.split('\n').filter(s => s.trim()).map(parseAnnotatedText);
            profile.localities = data.localities.split('\n').filter(s => s.trim()).map(line => {
                const parts = line.split('|');
                return { coordinate: parts[0]?.trim() || '', description: parts[1]?.trim() || '' };
            });
            profile.synonyms = data.synonyms.split('\n').filter(s => s.trim()).map(parseAnnotatedText);
            profile.diagnosis = data.diagnosis.trim();
            profile.description = data.description.trim();
            profile.etymology = data.etymology.trim();
            profile.discussion = data.discussion.trim();
            profile.updatedAt = Date.now();

            // 清理旧字段
            if (node.scientificNameRaw !== undefined) {
                delete node.scientificNameRaw;
                delete node.scientificName;
                delete node.author;
                delete node.commonName;
                delete node.distribution;
                delete node.habitat;
                delete node.synonyms;
                delete node.diagnosis;
                delete node.description;
                delete node.discussion;
                delete node.references;
            }

            node.name = commonName || parsed.scientificName || '未命名物种';

            saveAndRefresh();
            toast('✅ 已更新物种');
            return true;
        }
    });
}

function editContent(node) {
    showModal({
        title: '编辑笔记',
        fields: [
            { id: 'html', label: '内容（支持HTML / Markdown）', type: 'textarea', value: node.html || '', rows: 5 }
        ],
        onSave: function(data) {
            const html = data.html.trim();
            if (!html) { toast('请输入内容'); return false; }
            node.html = html;
            saveAndRefresh();
            toast('✅ 已更新笔记');
            const sel = Store.getSelectedNode();
            if (sel) showTaxonContent(sel);
            return true;
        }
    });
}

// ---------- 快速选择模式 ----------
function updateQuickSelectUI() {
    const count = Comparison.count();
    const max = Comparison.getMaxNodes();
    const countEl = document.getElementById('quickSelectCount');
    const maxEl = document.getElementById('quickSelectMax');
    if (countEl) countEl.textContent = count;
    if (maxEl) maxEl.textContent = max;
    // 重新渲染树和当前内容以更新选中标记
    renderTree();
    const selected = Store.getSelectedNode();
    if (selected) showTaxonContent(selected);
    updateComparisonEntry();
}

function enterQuickSelect() {
    if (InteractionState.mode === 'quickSelect') return;
    if (Comparison.isOpen()) Comparison.close();
    InteractionState.mode = 'quickSelect';
    const banner = document.getElementById('quickSelectBanner');
    if (banner) banner.style.display = 'flex';
    const header = document.getElementById('mainHeader');
    if (header && banner) {
        const bannerHeight = banner.offsetHeight;
        header.style.top = bannerHeight + 'px';
    }
    updateQuickSelectUI();
    updateComparisonEntry();
}

function exitQuickSelect() {
    if (InteractionState.mode !== 'quickSelect') return;
    InteractionState.mode = 'normal';
    const banner = document.getElementById('quickSelectBanner');
    if (banner) banner.style.display = 'none';
    const header = document.getElementById('mainHeader');
    if (header) header.style.top = '0px';
    if (Comparison.isOpen()) Comparison.close();
    // 刷新 UI 移除选中标记
    renderTree();
    const selected = Store.getSelectedNode();
    if (selected) showTaxonContent(selected);
    updateComparisonEntry();
}

// ===== Comparison 模式切换（Overlay 内部） =====
function updateComparisonModeUI() {
    const mode = Comparison.getMode();
    const parallelBtn = document.getElementById('comparisonModeParallel');
    const tableBtn = document.getElementById('comparisonModeTable');
    if (parallelBtn) {
        parallelBtn.classList.toggle('active', mode === 'parallel');
    }
    if (tableBtn) {
        tableBtn.classList.toggle('active', mode === 'table');
    }
}

function setComparisonMode(mode) {
    if (mode !== 'parallel' && mode !== 'table') return;
    Comparison.setMode(mode);
    updateComparisonModeUI();
}

function toggleQuickSelect() {
    if (InteractionState.mode === 'quickSelect') {
        exitQuickSelect();   // 退出快速选择模式，保留 Comparison 状态
    } else {
        enterQuickSelect();  // 进入快速选择模式
    }
    updateComparisonEntry(); // 更新按钮文字和状态
}
console.log("[DHI] data.js loaded");

const Store = (() => {

    let _treeData = null;
    let _taxonProfiles = {};
    let _selectedNode = null;
    let _idCounter = 1000;

    return {

        getTreeData(){
            return _treeData;
        },

        setTreeData(data){
            _treeData = data;
        },


        getTaxonProfiles(){
            return _taxonProfiles;
        },

        setTaxonProfiles(data){
            _taxonProfiles = data;
        },


        getSelectedNode(){
            return _selectedNode;
        },

        setSelectedNode(node){
            _selectedNode = node;
        },


        getIdCounter(){
            return _idCounter;
        },

        setIdCounter(value){
            _idCounter = value;
        },

        incrementIdCounter(){
            _idCounter++;
            return _idCounter;
        }

    };

})();

const CURRENT_VERSION = 'v1.3.0'
const TERMINAL_RANKS = ['species', 'nothospecies', 'subspecies', 'variety', 'form', 'cultivar'];

const DEFAULT_DATA = {
    id: 'root',
    name: '分类学笔记',
    type: 'taxon',
    version: CURRENT_VERSION,
    rank: '',
    rankName: '',
    children: []
};

// ============================================================
// 📦 IndexedDB 图片存储（绕开 localStorage 限制）
// ============================================================

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) { resolve(db); return; }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = function(e) {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) {
                d.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = function(e) {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = function(e) {
            if (!_dbErrorShown) {
        toast('⚠️ 无法访问本地数据库，图片功能将不可用（请检查浏览器隐私/存储设置）');
        _dbErrorShown = true;
        }
        reject(e.target.error);
        };
    });
}

function saveImageToDB(uuid, blob) {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put({ id: uuid, blob: blob });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    });
}

function getImageFromDB(uuid) {
    return openDB().then(db => {
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(uuid);
            req.onsuccess = () => resolve(req.result ? req.result.blob : null);
            req.onerror = () => resolve(null);
        });
    });
}

function getAllImagesFromDB() {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    });
}

function deleteImageFromDB(uuid) {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(uuid);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    });
}

// ============================================================
// 数据模型与工具函数
// ============================================================

// 判断节点是否为终端分类单元（物种、亚种、变种、变型、栽培品种等）
function isTerminalNode(node) {
    return node && node.type === 'taxon' && TERMINAL_RANKS.includes(node.rank);
}

// 原 getTaxonProfile已拆分
// ----- 空模板（供安全读取） -----
function getEmptyProfile() {
    return {
        scientificNameRaw: "",
        scientificName: "",
        author: "",
        commonName: "",
        distribution: [],
        habitat: "",
        phenology: [],
        localities: [],
        protologue: { text: "", link: "" },
        typeInformation: { text: "", link: "" },
        specimens: [],
        references: [],
        synonyms: [],
        diagnosis: "",
        description: "",
        etymology: "",
        discussion: "",
        createdAt: null,
        updatedAt: null
    };
}

function normalizeProfile(profile) {
    if (!profile) return;

    // ======================
    // distribution
    // ======================
    if (Array.isArray(profile.distribution)) {
        profile.distribution = profile.distribution.map(item => {
            // 旧格式：纯字符串
            if (typeof item === 'string') {
                return {
                    country: item,
                    areas: []
                };
            }
            // 新格式：对象
            if (item && typeof item === 'object') {
                let areas = [];
                if (Array.isArray(item.areas)) {
                    areas = item.areas.slice();   // 浅拷贝，保持不可变性
                } else if (item.areas !== undefined && item.areas !== null && item.areas !== '') {
                    // 若 areas 为字符串或其他单值，转为单元素数组
                    areas = [String(item.areas)];
                }
                return {
                    country: item.country || '',
                    areas: areas
                };
            }
            // 异常数据（如 null、数字等）
            return {
                country: '',
                areas: []
            };
        });
    } else if (typeof profile.distribution === 'string') {
        profile.distribution = parseDistributionText(profile.distribution);
    } else {
        profile.distribution = [];
    }

    // ======================
    // references
    // ======================
    if (Array.isArray(profile.references)) {
        profile.references = profile.references.map(item => {
            if (typeof item === 'string') {
                return parseAnnotatedText(item);
            }
            // 确保 text 和 link 字段存在
            return {
                text: (item && typeof item.text === 'string') ? item.text : "",
                link: (item && typeof item.link === 'string') ? item.link : ""
            };
        });
    } else {
        profile.references = [];
    }

    // ======================
    // synonyms
    // ======================
    if (Array.isArray(profile.synonyms)) {
        profile.synonyms = profile.synonyms.map(item => {
            if (typeof item === 'string') {
                return parseAnnotatedText(item);
            }
            return {
                text: (item && typeof item.text === 'string') ? item.text : "",
                link: (item && typeof item.link === 'string') ? item.link : ""
            };
        });
    } else {
        profile.synonyms = [];
    }

    // ======================
    // protologue / typeInformation
    // ======================
    for (const key of ['protologue', 'typeInformation']) {
        if (typeof profile[key] === 'string') {
            profile[key] = {
                text: profile[key],
                link: ""
            };
        } else if (!profile[key] || typeof profile[key] !== 'object') {
            profile[key] = {
                text: "",
                link: ""
            };
        } else {
            // 确保有 text 和 link
            profile[key].text = (typeof profile[key].text === 'string') ? profile[key].text : "";
            profile[key].link = (typeof profile[key].link === 'string') ? profile[key].link : "";
        }
    }

    // ======================
    // specimens
    // ======================
    if (!Array.isArray(profile.specimens)) {
        profile.specimens = [];
    } else {
        profile.specimens = profile.specimens.map(item => {
            if (typeof item === 'string') {
                return parseAnnotatedText(item);
            }
            if (item && typeof item === 'object') {
                return {
                    text: (typeof item.text === 'string') ? item.text : "",
                    link: (typeof item.link === 'string') ? item.link : ""
                };
            }
            return { text: "", link: "" };
        });
    }

    // ======================
    // array fields
    // ======================
    if (!Array.isArray(profile.phenology)) profile.phenology = [];
    if (!Array.isArray(profile.localities)) profile.localities = [];

    // ======================
    // string fallback
    // ======================
    profile.habitat = (typeof profile.habitat === 'string') ? profile.habitat : "";
    profile.diagnosis = (typeof profile.diagnosis === 'string') ? profile.diagnosis : "";
    profile.description = (typeof profile.description === 'string') ? profile.description : "";
    profile.etymology = (typeof profile.etymology === 'string') ? profile.etymology : "";
    profile.discussion = (typeof profile.discussion === 'string') ? profile.discussion : "";
}

function migrateAllProfiles() {
    let changed = false;
    const profiles = Store.getTaxonProfiles();
    for (const id in profiles) {
        const profile = profiles[id];
        const before = JSON.stringify(profile);
        normalizeProfile(profile);
        const after = JSON.stringify(profile);
        if (before !== after) {
            changed = true;
        }
    }
    if (changed) {
        Store.setTaxonProfiles(profiles);
        saveData();
        console.log("✅ Profile 数据结构已自动升级");
    }
}

// ----- 只读查询（不自动创建） -----
function getTaxonProfile(node) {
    if (!node) return null;
    const profiles = Store.getTaxonProfiles();
    return profiles[node.id] || null;
}

// ----- 安全读取（用于显示，返回完整空模板） -----
function getProfileSafe(node) {
    if (!node) return getEmptyProfile();
    let profile = getTaxonProfile(node);
    if (!profile) {
        profile = getEmptyProfile();
    } else {
        // ---------- 标准化旧数据结构 ----------
        if (!Array.isArray(profile.synonyms)) {
            profile.synonyms = [];
        } else if (profile.synonyms.length > 0 && typeof profile.synonyms[0] === 'string') {
            profile.synonyms = profile.synonyms.map(s => {
                if (typeof s === 'string') return parseAnnotatedText(s);
                return s;
            });
        }
        // 1. protologue：如果是字符串，转为对象 { text: 原字符串, link: '' }
        if (typeof profile.protologue === 'string') {
            profile.protologue = { text: profile.protologue, link: '' };
        } else if (!profile.protologue || typeof profile.protologue !== 'object') {
            profile.protologue = { text: '', link: '' };
        }
        // 2. typeInformation 同理
        if (typeof profile.typeInformation === 'string') {
            profile.typeInformation = { text: profile.typeInformation, link: '' };
        } else if (!profile.typeInformation || typeof profile.typeInformation !== 'object') {
            profile.typeInformation = { text: '', link: '' };
        }
        // 3. distribution：如果还是字符串，转为数组（简单处理）
        if (!Array.isArray(profile.distribution)) {
            if (typeof profile.distribution === 'string' && profile.distribution.trim()) {
                profile.distribution = [{ country: profile.distribution.trim(), areas: [] }];
            } else {
                profile.distribution = [];
            }
        }
        // 4. references：确保是数组
        if (!Array.isArray(profile.references)) {
            profile.references = [];
        }
        // 5. localities：确保是数组
        if (!Array.isArray(profile.localities)) {
            profile.localities = [];
        }
        // 6. 其他字段保证类型正确
        // 确保 phenology 是数组
        if (!Array.isArray(profile.phenology)) {
            profile.phenology = [];
        }
        if (typeof profile.habitat !== 'string') profile.habitat = '';
    }
    return profile;
}

// ----- 确保存在（用于编辑/保存，自动创建并初始化时间戳） -----
function ensureTaxonProfile(node) {
    if (!node) return null;
    const profiles = Store.getTaxonProfiles();
    if (!profiles[node.id]) {
        profiles[node.id] = {
            scientificNameRaw: "",
            scientificName: "",
            author: "",
            commonName: "",
            distribution: [],
            habitat: "",
            phenology: [],
            localities: [],
            protologue: { text: "", link: "" },
            typeInformation: { text: "", link: "" },
            specimens: [],
            references: [],            // 改为对象数组 [{text, link}]
            synonyms: [],
            diagnosis: "",
            description: "",
            etymology: "",
            discussion: "",
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        Store.setTaxonProfiles(profiles);
    }
    return profiles[node.id];
}

function ensureAllNodesHaveProfile(root) {
    if (!root) return;
    const all = getAllNodes(root);
    for (const { node } of all) {
        // 只为 taxon 节点（含物种）创建 profile
        if (node.type !== 'taxon') continue;

        const profile = ensureTaxonProfile(node);

        // 如果是物种（或拥有物种字段），复制旧字段
        if (isSpeciesNode(node)) {
            const fields = [
                'scientificNameRaw', 'scientificName', 'author', 'commonName',
                'distribution', 'habitat', 'synonyms',
                'diagnosis', 'description', 'discussion', 'references',
                'etymology', 'specimens', 'localities', 'phenology',
                'protologue', 'typeInformation'
            ];
            for (const field of fields) {
                const nodeVal = node[field];
                if (nodeVal !== undefined && nodeVal !== null && nodeVal !== '') {
                    const profileVal = profile[field];
                    // 如果 profile 中该字段为空（或空数组/空对象），则从 node 复制
                    if (profileVal === undefined || profileVal === null ||
                        (typeof profileVal === 'string' && profileVal === '') ||
                        (Array.isArray(profileVal) && profileVal.length === 0) ||
                        (typeof profileVal === 'object' && !Array.isArray(profileVal) && 
                        !profileVal.text && !profileVal.link)) {
                        // 深拷贝，避免引用
                        profile[field] = JSON.parse(JSON.stringify(nodeVal));
                    }
                }
            }
        }
    }
}

function findNodeById(root, id) {
    if (root.id === id) return root;
    if (root.children) {
        for (let child of root.children) {
            const found = findNodeById(child, id);
            if (found) return found;
        }
    }
    return null;
}

function findParent(root, childId) {
    if (root.children) {
        for (let child of root.children) {
            if (child.id === childId) return root;
            const found = findParent(child, childId);
            if (found) return found;
        }
    }
    return null;
}

// ===== 获取从根节点到目标节点的完整路径（不包含根节点） =====
function getNodePath(nodeId) {
    const path = [];
    let current = findNodeById(Store.getTreeData(), nodeId);
    if (!current) return path;

    while (current) {
        const parent = findParent(Store.getTreeData(), current.id);
        if (parent) {
            // 有父节点才说明不是根节点，放入路径
            path.unshift(current);
        }
        current = parent;
    }
    return path; // 例如 [根节点下的子分类节点, ..., 目标节点]
}

// ===== 获取节点所属的分类路径（只含 taxon 类型，不含根节点） =====
function getTaxonPath(node, root) {
    const path = [];
    let current = node;
    while (current && current.id !== root.id) {
        const parent = findParent(root, current.id);
        if (!parent) break;
        // 如果父级是 taxon，记录名称
        if (parent.type === 'taxon') {
            path.unshift(parent.name || '未命名分类');
        }
        current = parent;
    }
    return path; // 例如 ["报春苣苔属", "中华组"]
}

function getAllNodes(root, path) {
    path = path || [];
    const currentPath = path.concat(root);
    const result = [{ node: root, path: currentPath }];
    if (root.children) {
        for (let child of root.children) {
            result.push(...getAllNodes(child, currentPath));
        }
    }
    return result;
}

function getRankLabel(node) {
    if (node.type !== 'taxon') return '';
    const rank = node.rank || '';
    const rankName = node.rankName || '';
    
    const map = {
        'domain': '域',
        'kingdom': '界',
        'phylum': '门',
        'class': '纲',
        'order': '目',
        'family': '科',
        'genus': '属',
        'species': '物种',
        'nothospecies': '杂交种',
        'subspecies': '亚种',
        'variety': '变种',
        'form': '变型',
        'cultivar': '栽培品种'
    };
    
    if (rank === 'custom' && rankName) {
        return rankName;
    }
    return map[rank] || '';
}

function isSpeciesNode(node) {
    return node && node.type === 'taxon' && TERMINAL_RANKS.includes(node.rank);
}

function getDisplayName(node) {
    if (node.type === 'content') return '🗒︎';
    const profile = getProfileSafe(node);
    if (profile.commonName) return profile.commonName;
    if (profile.scientificName) return profile.scientificName;
    return node.name || '未命名';
}

function getTypeLabel(node) {
    if (node.type === 'content') return '笔记';
    if (isSpeciesNode(node)) return getRankLabel(node) || '物种';
    return '分类';
}

function getTypeBadgeClass(node) {
    if (node.type === 'content') return 'content';
    if (isSpeciesNode(node)) return 'species';
    return 'taxon';
}

// ===== 重建 idCounter（扫描树中所有节点ID） =====
function rebuildIdCounter(root) {
    let max = 0;
    (function scan(node) {
        if (typeof node.id === 'string' && node.id.startsWith('n')) {
            const num = parseInt(node.id.slice(1), 10);
            if (!isNaN(num) && num > max) {
                max = num;
            }
        }
        if (node.children) {
            for (let child of node.children) {
                scan(child);
            }
        }
    })(root);
    return max + 1; // 下一个可用ID
}

function generateId() {
    return 'n' + Store.incrementIdCounter();
}

// 递归收集节点及其所有子孙的 ID
function collectAllNodeIds(node) {
    const ids = [node.id];
    if (node.children) {
        for (let child of node.children) {
            ids.push(...collectAllNodeIds(child));
        }
    }
    return ids;
}

// ============================================================
// 🧪 数据验证函数
// ============================================================

function validateTaxonName(parent, name, excludeId) {
    const trimmed = name.trim();
    if (!trimmed) {
        return { valid: false, message: '⚠️ 请输入分类群名称' };
    }
    if (parent.children) {
        for (let child of parent.children) {
            if (child.id === excludeId) continue;
            if (child.type === 'taxon' && child.name === trimmed) {
                return { valid: false, message: '⚠️ 该分类群名称已存在，请勿重复' };
            }
        }
    }
    return { valid: true };
}

function validateSpeciesName(parent, commonName, scientificName, excludeId) {
    const cName = commonName.trim();
    const sName = scientificName.trim();
    if (!cName && !sName) {
        return { valid: false, message: '⚠️ 请至少填写中文俗名或学名' };
    }
    if (parent.children) {
        for (let child of parent.children) {
            if (child.id === excludeId) continue;
            if (isSpeciesNode(child)) {
                const profile = getProfileSafe(child);
                if (cName && profile.commonName === cName) {
                    return { valid: false, message: '⚠️ 该中文俗名已存在，请勿重复' };
                }
                if (sName && profile.scientificName === sName) {
                    return { valid: false, message: '⚠️ 该学名已存在，请勿重复' };
                }
            }
        }
    }
    return { valid: true };
}

// ============================================================
// CRUD核心操作
// ============================================================

function collectAllPhotoUUIDs(node) {
    const uuids = [];
    if (node.photos) {
        for (let p of node.photos) {
            if (p.isImageRef && p.uuid) {
                uuids.push(p.uuid);
            }
        }
    }
    if (node.children) {
        for (let child of node.children) {
            uuids.push(...collectAllPhotoUUIDs(child));
        }
    }
    return uuids;
}

function deleteNode(nodeId) {
    const node = findNodeById(Store.getTreeData(), nodeId);
    if (!node) return;
    const parent = findParent(Store.getTreeData(), nodeId);
    if (!parent) return;
    const name = getDisplayName(node);
    if (!confirm(`确定要删除「${name}」及其所有子项吗？\n（关联的图片也会被删除）`)) return;

    // 删除图片
    const uuids = collectAllPhotoUUIDs(node);
    if (uuids.length > 0) {
        Promise.all(uuids.map(uuid => deleteImageFromDB(uuid).catch(() => {})))
            .then(() => console.log(`🗑 已删除 ${uuids.length} 张关联图片`))
            .catch(() => {});
    }

    // 删除所有节点的 profile
    const allIds = collectAllNodeIds(node);
    const profiles = Store.getTaxonProfiles();
    for (let id of allIds) {
        delete profiles[id];
    }
    Store.setTaxonProfiles(profiles);

    const comparison = window.Comparison;
    if (comparison) {
        for (const id of allIds) {
            if (comparison.hasNode(id)) {
                comparison.removeNode(id);
            }
        }
    }

    parent.children = parent.children.filter(c => c.id !== nodeId);
    saveAndRefresh();
    toast(`🗑 已删除「${name}」及 ${uuids.length} 张图片`);
    const selected = Store.getSelectedNode();
    if (selected && selected.id === nodeId) {
        Store.setSelectedNode(parent);
        showTaxonContent(parent);
    } else if (selected) {
        showTaxonContent(selected);
    } else {
        showTaxonContent(
            Store.getTreeData()
        );
    }
}

// ============================================================
// 💾 数据持久化（统一版本管理）
// ============================================================

function saveData() {
    const data = Store.getTreeData();
    if (data) {
        data.version = CURRENT_VERSION;
        localStorage.setItem('taxonomyNotesData', JSON.stringify(data));
    }
    localStorage.setItem('taxonProfiles', JSON.stringify(Store.getTaxonProfiles()));
}

function loadData() {
    const saved = localStorage.getItem('taxonomyNotesData');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (!parsed.version) parsed.version = '1.0';
            parsed.version = migrateData(parsed);
            Store.setTreeData(parsed);
            const newIdCounter = rebuildIdCounter(
                Store.getTreeData()
            );
            Store.setIdCounter(newIdCounter);
        } catch (e) {
            console.warn('数据加载失败，将使用默认数据', e);
            return false;
        }
    } else {
        return false;
    }

    const profiles = localStorage.getItem('taxonProfiles');
    if (profiles) {
        try {
            const loadedProfiles = JSON.parse(profiles);
            Store.setTaxonProfiles(loadedProfiles);
        } catch (e) {
            console.warn('taxonProfiles 损坏，重新创建', e);
            Store.setTaxonProfiles({});
        }
    } else {
        Store.setTaxonProfiles({});
    }

    ensureAllNodesHaveProfile(Store.getTreeData());
    migrateAllProfiles();

    return true;
}

// ===== 版本迁移系统（P0-1 改进） =====
function migrateData(data) {
    const version = data.version || '1.0';
    let migrated = data;

    // ---- 未来迁移规则（留空） ----
    // if (version === '1.0') { ... 迁移到 1.2 }
    // if (version === '1.2') { ... 迁移到 2.0 }
    // ... 更多迁移

    // 当前所有版本都执行字段补全（向下兼容）
    migrated = ensureAllFields(migrated);

    // 更新版本号为最新
    migrated.version = CURRENT_VERSION;
    return migrated.version; // 返回最新版本
}

// 补全缺失字段（确保所有节点结构完整）
function ensureAllFields(data) {
    function walk(node) {
        if (!node) return;
        node.photos ||= [];
        node.children ||= [];
        node.type ||= 'taxon';

        // --- ✅ 第一步：迁移旧物种节点（type === 'species'）为 taxon ---
        if (node.type === 'species') {
            // 1. 迁移旧字段 latinName / authors → scientificNameRaw
            if (node.latinName || node.authors) {
                let combined = (node.latinName || '') + (node.authors ? ' ' + node.authors : '');
                if (combined.trim() && !node.scientificNameRaw) {
                    const parsed = parseScientificName(combined);
                    node.scientificNameRaw = combined.trim();
                    node.scientificName = parsed.scientificName;
                    node.author = parsed.author;
                }
                delete node.latinName;
                delete node.authors;
            }

            // 2. 确保所有物种特有字段存在
            node.scientificNameRaw = node.scientificNameRaw || '';
            node.scientificName = node.scientificName || '';
            node.author = node.author || '';
            node.commonName = node.commonName || '';
            node.distribution = node.distribution || '';
            node.habitat = node.habitat || '';
            node.synonyms = node.synonyms || [];
            node.diagnosis = node.diagnosis || '';
            node.description = node.description || '';
            node.discussion = node.discussion || '';
            node.references = node.references || [];

            // 3. 设置显示名称 name（优先 commonName，其次 scientificName）
            node.name = node.commonName || node.scientificName || '未命名物种';

            // 4. ⭐ 转换为 taxon，设置 rank 为 species（若已有 rank 则保留）
            node.type = 'taxon';
            node.rank = node.rank || 'species';
            node.rankName = '';  // 物种的 rankName 恒为空
        }

        // --- 第二步：处理 content 节点 ---
        if (node.type === 'content') {
            node.html = node.html || '';
        }

        // --- 第三步：处理所有 taxon 节点（包括迁移后的物种） ---
        if (node.type === 'taxon') {
            // 确保 name 字段（若为空则补默认值，但不会覆盖已有值）
            node.name = node.name || '未命名分类群';

            // ⭐ 补全：如果节点拥有物种字段但 rank 为空，默认设为 species
            if ((node.scientificName || node.commonName) && !node.rank) {
                node.rank = 'species';
                node.rankName = '';
            }

            // 标准阶元列表（与添加子分类的选项保持一致）
            const STANDARD_RANKS = [
                'domain', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus',
                'species', 'nothospecies', 'subspecies', 'variety', 'form', 'cultivar'
            ];

            // 处理 rank 迁移：非标准值转为 custom，并存入 rankName
            if (node.rank !== undefined && node.rank !== null && node.rank !== '') {
                if (STANDARD_RANKS.includes(node.rank)) {
                    node.rankName = '';   // 标准阶元清空 rankName
                } else {
                    // 如果已经是 custom，则保留现有 rankName（不覆盖）
                    if (node.rank === 'custom') {
                        // 仅保证 rankName 存在（可为空）
                        if (node.rankName === undefined || node.rankName === null) {
                            node.rankName = '';
                        }
                    } else {
                        // 其他非标准值 → 迁移为 custom，原值存入 rankName
                        node.rankName = node.rank;
                        node.rank = 'custom';
                    }
                }
            } else {
                node.rank = '';
                node.rankName = '';
            }
        }

        // --- 递归处理子节点 ---
        if (node.children) {
            for (let child of node.children) {
                walk(child);
            }
        }
    }
    walk(data);
    return data;
}

function saveAndRefresh() {
    saveData();
    renderTree();
    const selected = Store.getSelectedNode();
    if (selected) {
        const refreshed = findNodeById(
            Store.getTreeData(),
            selected.id
        );
        if (refreshed) {
            Store.setSelectedNode(refreshed);
            showTaxonContent(refreshed);
        } else {
            Store.setSelectedNode(
                Store.getTreeData()
            );
            showTaxonContent(
                Store.getTreeData()
            );
        }
    }
}

// ============================================================
// 📤 导入导出（含 IndexedDB 图片 + UUID 冲突处理 + 版本兼容）
// ============================================================

// 导入辅助
function replaceImageUUIDsInObject(obj, conflictMap) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = replaceImageUUIDsInObject(obj[i], conflictMap);
        }
    } else {
        for (let key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (typeof obj[key] === 'string') {
                    let str = obj[key];
                    for (let [old, newU] of conflictMap) {
                        str = str.split(`[img:${old}]`).join(`[img:${newU}]`);
                    }
                    obj[key] = str;
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    obj[key] = replaceImageUUIDsInObject(obj[key], conflictMap);
                }
            }
        }
    }
    return obj;
}

async function importDataOverwrite(data) {
    // 深拷贝，避免污染原始对象
    const importData = JSON.parse(JSON.stringify(data));
    try {
        if (!importData.treeData || !importData.treeData.id) {
            toast('❌ 无效的数据格式：缺少 treeData');
            return;
        }

        let importedTree = importData.treeData;
        if (!importedTree.version) importedTree.version = '1.0';
        const newVersion = migrateData(importedTree);
        importedTree.version = newVersion;

        // 图片 UUID 冲突处理
        let existingUUIDs = new Set();
        try {
            const existing = await getAllImagesFromDB();
            existingUUIDs = new Set(existing.map(entry => entry.id));
        } catch (err) { /* ignore */ }

        const conflictMap = new Map();
        const imageEntries = importData.images || {};
        for (let [uuid] of Object.entries(imageEntries)) {
            if (existingUUIDs.has(uuid)) {
                conflictMap.set(uuid, generateUUID());
            }
        }

        // 应用图片 UUID 冲突映射（更新 treeData）
        if (conflictMap.size > 0) {
            // 替换 treeData 中所有文本里的图片引用
            const jsonStr = JSON.stringify(importedTree);
            let updatedStr = jsonStr;
            for (let [old, newU] of conflictMap) {
                updatedStr = updatedStr.split(`[img:${old}]`).join(`[img:${newU}]`);
            }
            importedTree = JSON.parse(updatedStr);
            // 同时修改 imageEntries 的键
            const newImages = {};
            for (let [old, base64] of Object.entries(imageEntries)) {
                const newKey = conflictMap.has(old) ? conflictMap.get(old) : old;
                newImages[newKey] = base64;
            }
            importData.images = newImages;
            toast(`🔄 检测到 ${conflictMap.size} 个图片UUID冲突，已重新生成`);
        }

        // 存储图片到 IndexedDB
        let savedCount = 0;
        for (let [uuid, base64] of Object.entries(importData.images || {})) {
            try {
                const response = await fetch(base64);
                const blob = await response.blob();
                await saveImageToDB(uuid, blob);
                savedCount++;
            } catch (err) {
                console.warn('图片存储失败', uuid, err);
            }
        }

        // ------ 新增：对 taxonProfiles 中的所有字符串进行图片 UUID 替换 ------
        const profiles = importData.taxonProfiles || {};
        for (let id in profiles) {
            if (profiles.hasOwnProperty(id)) {
                replaceImageUUIDsInObject(profiles[id], conflictMap);
            }
        }
        // -------------------------------------------------------------

        // 替换 treeData
        Store.setTreeData(importedTree);
        Store.setTaxonProfiles(profiles);  // 使用已处理的 profiles
        ensureAllNodesHaveProfile(importedTree);
        migrateAllProfiles();

        // 清理孤立 profile
        const validIds = new Set();
        collectAllNodeIds(importedTree).forEach(id => validIds.add(id));
        const currentProfiles = Store.getTaxonProfiles();
        for (const id of Object.keys(currentProfiles)) {
            if (!validIds.has(id)) delete currentProfiles[id];
        }

        Store.setIdCounter(rebuildIdCounter(importedTree));
        saveData();

        Store.setSelectedNode(importedTree);
        renderTree();
        showTaxonContent(importedTree);
        localStorage.setItem('lastExportTime', Date.now().toString());

        toast(`✅ 导入成功！版本 ${importData.version || '1.0'} → ${importedTree.version}，恢复 ${savedCount} 张图片`);
    } catch (err) {
        console.error('覆盖导入失败:', err);
        toast('❌ 覆盖导入失败: ' + err.message);
    }
}

// 追加导入
async function importDataAppend(data) {
    // 深拷贝，避免污染原始对象
    const importData = JSON.parse(JSON.stringify(data));
    try {
        if (!importData.treeData || !importData.treeData.id) {
            toast('❌ 无效的数据格式：缺少 treeData');
            return;
        }

        // 1. 迁移
        let importedTree = importData.treeData;
        if (!importedTree.version) importedTree.version = '1.0';
        const newVersion = migrateData(importedTree);
        importedTree.version = newVersion;

        let childrenToImport = importedTree.children || [];
        if (childrenToImport.length === 0) {
            toast('⚠️ 导入数据无子节点，无内容可追加');
            return;
        }

        // 2. 生成节点 ID 映射（全部重新生成）
        const idMap = new Map();
        function remapNodeIds(nodes) {
            for (let node of nodes) {
                const oldId = node.id;
                const newId = generateId();          // 自动递增 Store.idCounter
                idMap.set(oldId, newId);
                node.id = newId;
                if (node.children) remapNodeIds(node.children);
            }
        }
        remapNodeIds(childrenToImport);

        // 3. 生成图片 UUID 冲突映射
        const allUUIDs = new Set();
        function collectUUIDsFromTree(nodes) {
            for (let node of nodes) {
                if (node.photos) {
                    for (let p of node.photos) {
                        if (p.uuid) allUUIDs.add(p.uuid);
                    }
                }
                if (node.children) collectUUIDsFromTree(node.children);
            }
        }
        collectUUIDsFromTree(childrenToImport);
        // 从字符串中提取
        const jsonStr = JSON.stringify(childrenToImport);
        const matches = jsonStr.match(/\[img:([^\]]+)\]/g) || [];
        for (let m of matches) {
            const uuid = m.slice(5, -1);
            allUUIDs.add(uuid);
        }

        const existing = await getAllImagesFromDB();
        const existingSet = new Set(existing.map(e => e.id));
        const conflictMap = new Map();
        for (let uuid of allUUIDs) {
            if (existingSet.has(uuid) && !conflictMap.has(uuid)) {
                conflictMap.set(uuid, generateUUID());
            }
        }

        // 4. 统一 remap：图片 UUID（字符串替换 + photos 字段）
        if (conflictMap.size > 0) {
            // 更新 photos 中的 uuid
            function updatePhotoUUIDs(nodes) {
                for (let node of nodes) {
                    if (node.photos) {
                        for (let p of node.photos) {
                            if (p.uuid && conflictMap.has(p.uuid)) {
                                p.uuid = conflictMap.get(p.uuid);
                            }
                        }
                    }
                    if (node.children) updatePhotoUUIDs(node.children);
                }
            }
            updatePhotoUUIDs(childrenToImport);

            // 替换所有字符串中的 [img:old] → [img:new]
            replaceImageUUIDsInObject(childrenToImport, conflictMap);

            // 更新 importData.images 的键
            const newImages = {};
            for (let [old, base64] of Object.entries(importData.images || {})) {
                const newKey = conflictMap.has(old) ? conflictMap.get(old) : old;
                newImages[newKey] = base64;
            }
            importData.images = newImages;

            toast(`🔄 检测到 ${conflictMap.size} 个图片UUID冲突，已重新生成`);
        }

        // 5. 写入图片到 IndexedDB
        let savedCount = 0;
        for (let [uuid, base64] of Object.entries(importData.images || {})) {
            try {
                const response = await fetch(base64);
                const blob = await response.blob();
                await saveImageToDB(uuid, blob);
                savedCount++;
            } catch (err) {
                console.warn('图片存储失败', uuid, err);
            }
        }

        // 6. 合并 tree 和 profiles
        const root = Store.getTreeData();
        if (!root.children) root.children = [];
        root.children.push(...childrenToImport);

        // 合并 profiles
        const currentProfiles = Store.getTaxonProfiles();
        const importedProfiles = importData.taxonProfiles || {};
        for (let [oldId, newId] of idMap) {
            if (importedProfiles[oldId]) {
                currentProfiles[newId] = importedProfiles[oldId];
            }
        }
        // 对合并后的 profiles 中的字符串进行图片 UUID 替换
        for (let id of idMap.values()) {
            if (currentProfiles[id]) {
                replaceImageUUIDsInObject(currentProfiles[id], conflictMap);
            }
        }
        Store.setTaxonProfiles(currentProfiles);

        // 7. 补全并统一 profile
        ensureAllNodesHaveProfile(root);
        migrateAllProfiles();

        // 8. 重建 idCounter
        Store.setIdCounter(rebuildIdCounter(root));

        // 9. 保存
        saveData();

        // 10. 刷新 UI
        renderTree();
        if (childrenToImport.length > 0) {
            jumpToNode(childrenToImport[0]);  // 传入节点对象
        } else {
            showTaxonContent(root);
        }

        toast(`✅ 成功追加导入 ${childrenToImport.length} 个顶级节点，${savedCount} 张图片`);
    } catch (err) {
        console.error('追加导入失败:', err);
        toast('❌ 追加导入失败: ' + err.message);
    }
}

// 辅助函数：收集树中所有被引用的图片 UUID
function collectAllReferencedUUIDs(root) {
    const uuids = [];
    function walk(node) {
        if (!node) return;
        // 检查当前节点的 photos
        if (Array.isArray(node.photos)) {
            for (let p of node.photos) {
                if (p.isImageRef && p.uuid) {
                    uuids.push(p.uuid);
                }
            }
        }
        // 递归子节点
        if (Array.isArray(node.children)) {
            for (let child of node.children) {
                walk(child);
            }
        }
    }
    walk(root);
    return uuids;
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.treeData || !data.treeData.id) {
                toast('❌ 无效的数据格式：缺少 treeData');
                event.target.value = '';
                return;
            }

            const root = Store.getTreeData();
            const isEmpty = !root.children || root.children.length === 0;
            // 如果为空，直接执行覆盖导入（覆盖空树与追加结果相同）
            if (isEmpty) {
                await importDataOverwrite(data);
                event.target.value = '';
                return;
            }

            // 保存数据到闭包，供按钮回调使用
            window._importDataObj = data;

            // 显示选择模态框
            showModal({
                title: '导入 JSON 数据',
                content: `
                    <p style="margin-bottom:16px;">请选择导入方式：</p>
                    <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                        <button id="importAppendBtn" class="btn-save" style="font-size:1rem; padding:8px 24px;">
                            📥︎ 追加新内容
                        </button>
                        <button id="importOverwriteBtn" class="btn-danger" style="font-size:1rem; padding:8px 24px;">
                            🔄︎ 替换当前内容
                        </button>
                        <button id="importCancelBtn" class="btn-cancel" style="font-size:1rem; padding:8px 24px;">
                            取消
                        </button>
                    </div>
                    <p style="margin-top:16px; color:#666; font-size:0.9rem;">
                        “追加”不会覆盖现有数据，所有节点将生成新的 ID。<br>
                        “替换”将完全覆盖当前树。
                    </p>
                `,
                hideFooter: true,
                allowOverlayClose: false
            });

            // 绑定按钮事件
            const appendBtn = document.getElementById('importAppendBtn');
            const overwriteBtn = document.getElementById('importOverwriteBtn');
            const cancelBtn = document.getElementById('importCancelBtn');

            if (appendBtn) {
                appendBtn.onclick = function() {
                    closeModal();
                    const data = window._importDataObj;
                    importDataAppend(data);
                    window._importDataObj = null;
                };
            }
            if (overwriteBtn) {
                overwriteBtn.onclick = function() {
                    closeModal();
                    const data = window._importDataObj;
                    importDataOverwrite(data);
                    window._importDataObj = null;
                };
            }
            if (cancelBtn) {
                cancelBtn.onclick = function() {
                    closeModal();
                    window._importDataObj = null;
                };
            }

        } catch (err) {
            console.error('读取 JSON 失败:', err);
            toast('❌ 文件解析失败: ' + err.message);
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

async function exportData() {
    // ===== 1. 生成安全的默认文件名（含完整时间） =====
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const defaultName = `分类学笔记_${dateStr}_${timeStr}`;

    // ===== 2. 弹窗让用户自定义文件名 =====
    let fileName = prompt('请输入导出的JSON文件名（不含扩展名）：', defaultName);
    if (fileName === null) return; // 用户取消
    fileName = fileName.trim() || defaultName;
    if (!fileName.toLowerCase().endsWith('.json')) {
        fileName += '.json';
    }

    try {
        // ===== 3. 收集树中实际引用的 UUID =====
        const referencedUUIDs = new Set(collectAllReferencedUUIDs(Store.getTreeData()));
        console.log(`📊 树中引用图片数: ${referencedUUIDs.size}`);

        // ===== 4. 获取 IndexedDB 全部图片，但只导出被引用的 =====
        const allImages = await getAllImagesFromDB();
        const imageMap = {};
        let exportedCount = 0;

        for (let entry of allImages) {
            // 只导出在树中被引用的图片
            if (!referencedUUIDs.has(entry.id)) {
                console.debug(`⏭️ 跳过孤儿图片: ${entry.id}`);
                continue;
            }
            try {
                const base64 = await blobToBase64(entry.blob);
                imageMap[entry.id] = base64;
                exportedCount++;
            } catch (e) {
                console.warn('图片转换失败', entry.id, e);
            }
        }

        // ===== 5. 组装并导出 =====
        const exportVersion = Store.getTreeData().version || CURRENT_VERSION;
        const exportObj = {
            treeData: Store.getTreeData(),
            images: imageMap,
            taxonProfiles: Store.getTaxonProfiles(),
            version: exportVersion
        };

        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();

        // ===== 6. 提示用户 =====
        localStorage.setItem('lastExportTime', Date.now().toString());
        // 显示实际导出的图片数（而非 IndexedDB 总数）
        toast(`📥 数据已导出（版本 ${exportVersion}，含 ${exportedCount} 张本地内嵌图片）`);
        
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
        console.error(err);
        toast('❌ 导出失败: ' + err.message);
    }
}

// ============================================================
// 🔄 重置
// ============================================================

function resetAll() {
    if (!confirm('⚠️ 确定要重置所有数据吗？此操作不可撤销！')) return;
    Store.setTreeData(
        deepClone(DEFAULT_DATA)
    );
    Store.getTreeData().version = CURRENT_VERSION;
    Store.setTaxonProfiles({});
    Store.setSelectedNode(
        Store.getTreeData()
    );
    Store.setIdCounter(1000);
    saveData();
    getAllImagesFromDB().then(entries => { for (let entry of entries) { deleteImageFromDB(entry.id).catch(() => {}); } }).catch(() => {});
    renderTree();
    showTaxonContent(
        Store.getTreeData()
    );
    toast('🗑 已重置所有数据');
}

function collectUsedUUIDs() {
    const root = Store.getTreeData();
    const used = new Set();
    if (!root) return used;

    function walk(node) {
        if (!node) return;
        if (Array.isArray(node.photos)) {
            for (let p of node.photos) {
                if (p.isImageRef && p.uuid) used.add(p.uuid);
            }
        }
        if (Array.isArray(node.children)) {
            for (let child of node.children) walk(child);
        }
    }
    walk(root);

    // 兜底：通过 JSON 字符串提取
    const jsonStr = JSON.stringify(Store.getTreeData());
    const matches = jsonStr.match(/\[img:([^\]]+)\]/g);
    if (matches) {
        for (let m of matches) {
            const uuid = m.slice(5, -1);
            used.add(uuid);
        }
    }
    return used;
}

async function scanOrphanImages() {
    try {
        const used = collectUsedUUIDs();
        const allEntries = await getAllImagesFromDB();
        const orphans = allEntries.filter(entry => !used.has(entry.id));

        if (orphans.length === 0) {
            toast('✅ 没有孤立图片，数据整洁！');
            return;
        }

        // 计算总大小（近似）
        let totalSize = 0;
        for (let entry of orphans) {
            totalSize += entry.blob.size;
        }
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);

        // 构建孤儿列表预览（最多显示 20 条）
        let listHtml = orphans.slice(0, 20).map(e => 
            `<div style="padding:2px 0;font-size:0.9rem;border-bottom:1px solid #eee;">${e.id}</div>`
        ).join('');
        if (orphans.length > 20) {
            listHtml += `<div style="color:#888;padding:4px 0;">… 还有 ${orphans.length - 20} 个</div>`;
        }

        showModal({
            title: `⌧ 清理孤立图片（${orphans.length} 张）`,
            content: `
                <p>以下图片未被任何节点引用，占用约 <strong>${sizeMB} MB</strong>。</p>
                <div style="max-height:200px;overflow-y:auto;background:#f9fafb;padding:6px 10px;border-radius:6px;border:1px solid #e0e4e8;margin:10px 0;">
                    ${listHtml}
                </div>
                <p style="color:#666;font-size:0.85rem;">删除后不可恢复，请确认已导出备份。</p>
            `,
            saveText: '🗑 删除全部孤立图片',
            onSave: async function() {
                // 二次确认
                if (!confirm(`确定删除 ${orphans.length} 张孤立图片吗？此操作不可撤销。`)) {
                    return false; // 返回 false 阻止模态框关闭
                }
                // 执行删除
                let deleted = 0;
                for (let entry of orphans) {
                    try {
                        await deleteImageFromDB(entry.id);
                        deleted++;
                    } catch (e) {
                        console.warn('删除失败', entry.id, e);
                    }
                }
                toast(`🗑 已删除 ${deleted} 张孤立图片，释放约 ${sizeMB} MB`);
                // 可选：记录清理时间
                localStorage.setItem('lastImageCleanup', Date.now().toString());
                return true; // 允许关闭模态框
            }
        });

    } catch (err) {
        console.error(err);
        toast('❌ 扫描失败：' + err.message);
    }
}

/**
 * 创建物种/终端分类节点（共享逻辑）
 * @param {Object} parent - 父节点（必须是 taxon 类型且非物种）
 * @param {Object} data - 标准化数据，包含以下字段（均已解析/验证）：
 *   { scientificNameRaw, commonName, rank, distribution, habitat, phenology,
 *     localities, protologue, typeInformation, specimens, references,
 *     synonyms, diagnosis, description, etymology, discussion }
 *   注：photos 字段暂不支持，V1 忽略
 * @returns {Object} 新创建的 node 对象
 */
function createSpeciesNode(parent, data) {
    if (!parent || parent.type !== 'taxon' || isSpeciesNode(parent)) {
        throw new Error('父节点必须是分类节点且不能是物种');
    }

    // 1. 生成唯一 ID
    const id = generateId();

    // 2. 解析学名（如果提供了 scientificNameRaw）
    let scientificName = '';
    let author = '';
    if (data.scientificNameRaw) {
        const parsed = parseScientificName(data.scientificNameRaw);
        scientificName = parsed.scientificName;
        author = parsed.author;
    }

    // 3. 构造 node 对象
    const node = {
        id: id,
        type: 'taxon',
        rank: data.rank || 'species',          // 默认 species
        rankName: '',                           // 物种不使用 rankName
        name: data.commonName || scientificName || '未命名物种',
        children: [],
        // photos:  V1 不支持，留空
    };

    // 4. 确保 profile 存在（创建空模板）
    const profile = ensureTaxonProfile(node);

    // 5. 填充 profile 字段（直接赋值，不再次解析）
    profile.scientificNameRaw = data.scientificNameRaw || '';
    profile.scientificName = scientificName;
    profile.author = author;
    profile.commonName = data.commonName || '';
    profile.distribution = data.distribution || [];      // 已通过 parseDistributionText 解析
    profile.habitat = data.habitat || '';
    profile.phenology = data.phenology || [];            // 已通过 parsePhenologyText 解析
    profile.localities = data.localities || [];          // 已通过 split('|') 解析
    profile.protologue = data.protologue || { text: '', link: '' };
    profile.typeInformation = data.typeInformation || { text: '', link: '' };
    profile.specimens = data.specimens || [];            // 已通过 parseAnnotatedText 解析
    profile.references = data.references || [];
    profile.synonyms = data.synonyms || [];
    profile.diagnosis = data.diagnosis || '';
    profile.description = data.description || '';
    profile.etymology = data.etymology || '';
    profile.discussion = data.discussion || '';
    profile.updatedAt = Date.now();

    // 6. 挂载到父节点
    if (!parent.children) parent.children = [];
    parent.children.push(node);

    return node;
}
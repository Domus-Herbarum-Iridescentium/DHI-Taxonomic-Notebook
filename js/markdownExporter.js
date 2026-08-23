console.log("[DHI] markdownExporter.js loaded");

// ============================================================
// DHI Taxonomic Notebook
// Markdown Exporter
// Markdown Export v1 — Phase 1
//
// Current phase:
//   1. Species Profile Schema
//   2. Export API
//   3. Export root resolution
//
// Not implemented yet:
//   - Markdown traversal
//   - Species Profile rendering
//   - Images
//   - IndexedDB image export
//   - External image download
//   - JSZip
// ============================================================


// ============================================================
// 1. Species Profile Schema
// ============================================================
//
// Specification v1.0
//
// Profile fields are defined here rather than hard-coded inside
// the recursive export logic.
//
// Future fields can be added here without changing the core
// traversal architecture.
//

const SPECIES_PROFILE_SCHEMA = [
    // --------------------------------------------------------
    // Taxonomy
    // --------------------------------------------------------

    {
        key: 'synonyms',
        section: 'taxonomy',
        title: '异名',
        type: 'list'
    },
    {
        key: 'protologue',
        section: 'taxonomy',
        title: '原始发表',
        type: 'annotation'
    },
    {
        key: 'typeInformation',
        section: 'taxonomy',
        title: '模式信息',
        type: 'annotation'
    },
    {
        key: 'specimens',
        section: 'taxonomy',
        title: '标本',
        type: 'list'
    },

    // --------------------------------------------------------
    // Ecology
    // --------------------------------------------------------

    {
        key: 'distribution',
        section: 'ecology',
        title: '分布',
        type: 'inline'
    },
    {
        key: 'habitat',
        section: 'ecology',
        title: '生境',
        type: 'inline'
    },
    {
        key: 'phenology',
        section: 'ecology',
        title: '物候',
        type: 'structured'
    },
    {
        key: 'localities',
        section: 'ecology',
        title: '点位记录',
        type: 'list'
    },

    // --------------------------------------------------------
    // Morphology
    // --------------------------------------------------------

    {
        key: 'diagnosis',
        section: 'morphology',
        title: '鉴定要点',
        type: 'markdown'
    },
    {
        key: 'description',
        section: 'morphology',
        title: '描述',
        type: 'markdown'
    },
    {
        key: 'etymology',
        section: 'morphology',
        title: '词源',
        type: 'markdown'
    },
    {
        key: 'discussion',
        section: 'morphology',
        title: '讨论',
        type: 'markdown'
    },

    // --------------------------------------------------------
    // References
    // --------------------------------------------------------

    {
        key: 'references',
        section: 'references',
        title: '参考文献',
        type: 'ordered-list'
    }
];


// ============================================================
// 2. Export Constants
// ============================================================

const MARKDOWN_EXPORT_FULL_NAME = 'DHI分类学笔记';


// ============================================================
// 3. Public Export API
// ============================================================
//
// Specification:
//
// exportMarkdown({
//     mode: 'subtree',
//     targetNodeId: nodeId
// });
//
// exportMarkdown({
//     mode: 'full'
// });
//
// The exporter receives only persistent-data identifiers.
// It does NOT receive:
//   - selectedNode
//   - DOM elements
//   - expanded IDs
//   - current view
//   - UI state
//

function exportMarkdown(options = {}) {
    const exportContext = resolveMarkdownExportRoot(options);

    const markdown = renderMarkdownExportTree(
        exportContext
    );

    return {
        ...exportContext,
        markdown
    };
}


// ============================================================
// 4. Export Root Resolution
// ============================================================

function resolveMarkdownExportRoot(options = {}) {
    const { mode, targetNodeId } = options;

    // --------------------------------------------------------
    // Validate mode
    // --------------------------------------------------------

    if (mode !== 'full' && mode !== 'subtree') {
        throw new Error(
            'Markdown export failed: invalid export mode.'
        );
    }

    // --------------------------------------------------------
    // Get persistent taxonomy tree
    //
    // Do not use:
    //   Store.getSelectedNode()
    //
    // Export API must not depend on UI selection state.
    // --------------------------------------------------------

    const treeData = Store.getTreeData();

    if (!treeData || typeof treeData !== 'object') {
        throw new Error(
            'Markdown export failed: treeData is invalid.'
        );
    }

    // --------------------------------------------------------
    // Full Notebook
    //
    // The actual tree root is used only as the traversal root.
    // The root itself will NOT be exported.
    //
    // Specification:
    //
    // ROOT
    // ├── A
    // └── B
    //
    // becomes:
    //
    // # A
    // # B
    // --------------------------------------------------------

    if (mode === 'full') {
        return {
            mode: 'full',
            rootNode: treeData,
            rootNodeId: treeData.id ?? null,
            rootName: MARKDOWN_EXPORT_FULL_NAME,
            isSyntheticExportRoot: false
        };
    }

    // --------------------------------------------------------
    // Subtree
    //
    // targetNodeId is mandatory.
    // --------------------------------------------------------

    if (
        typeof targetNodeId !== 'string' ||
        targetNodeId.trim() === ''
    ) {
        throw new Error(
            'Markdown export failed: targetNodeId is required for subtree export.'
        );
    }

    const targetNode = findMarkdownExportNodeById(
        treeData,
        targetNodeId
    );

    if (!targetNode) {
        throw new Error(
            `Markdown export failed: export root "${targetNodeId}" does not exist.`
        );
    }

    return {
        mode: 'subtree',
        rootNode: targetNode,
        rootNodeId: targetNode.id,
        rootName: getMarkdownExportNodeDisplayName(targetNode),
        isSyntheticExportRoot: false
    };
}


// ============================================================
// 5. Find Node by ID
// ============================================================
//
// This is intentionally local to the exporter for now.
//
// We do NOT introduce another generic tree-search utility into
// utils.js yet.
//
// Reason:
//   This function is part of export-root resolution and can later
//   be replaced by an existing generic tree lookup if we confirm
//   that one is suitable.
//
// Traversal order follows node.children exactly.
//

function findMarkdownExportNodeById(node, targetNodeId) {
    if (!node || typeof node !== 'object') {
        return null;
    }

    if (node.id === targetNodeId) {
        return node;
    }

    if (!Array.isArray(node.children)) {
        return null;
    }

    for (const child of node.children) {
        const result = findMarkdownExportNodeById(
            child,
            targetNodeId
        );

        if (result) {
            return result;
        }
    }

    return null;
}


// ============================================================
// 6. Export Root Display Name
// ============================================================
//
// For subtree export the Specification says:
//
//   使用选中节点的显示名称
//
// At this stage we deliberately keep this helper simple.
//
// Later, when filesystem-safe normalization is introduced for
// ZIP / Markdown filenames, that normalization will happen at
// the package-output layer rather than altering the taxonomy
// node itself.
//

function getMarkdownExportNodeDisplayName(node) {
    if (!node || typeof node !== 'object') {
        return '未命名分类群';
    }

    const name = typeof node.name === 'string'
        ? node.name.trim()
        : '';

    return name || '未命名分类群';
}

// ============================================================
// 7. Markdown Tree Traversal
// ============================================================
//
// Traversal follows node.children exactly.
// No sorting or reordering is performed.
//
// Full export:
//   ROOT is traversal-only and does not generate Markdown.
//
// Subtree export:
//   selected export root becomes H1.
// ============================================================

function renderMarkdownExportTree(exportContext) {
    if (!exportContext || !exportContext.rootNode) {
        throw new Error(
            'Markdown export failed: export root is unavailable.'
        );
    }

    const blocks = [];
    const { mode, rootNode } = exportContext;
    const effectiveMode = (rootNode.id === 'root') ? 'full' : mode;

    if (effectiveMode === 'full') {
        const children = Array.isArray(rootNode.children)
            ? rootNode.children
            : [];

        for (const child of children) {
            renderMarkdownNode(child, 1, blocks);
        }
    } else {
        // 子树模式：根节点本身成为 H1
        renderMarkdownNode(rootNode, 1, blocks);
    }

    return joinMarkdownBlocks(blocks);
}

// ============================================================
// 8. Generic Node Renderer
// ============================================================
//
// Supported node types:
//   - root
//   - taxon
//   - content
//
// Root is never rendered as a taxonomy heading.
// ============================================================

function renderMarkdownNode(node, depth, blocks) {
    if (!node || typeof node !== 'object') {
        return;
    }

    // --------------------------------------------------------
    // Root
    // --------------------------------------------------------
    //
    // Root is structural only.
    // It does not generate heading/content/image.
    //

    if (node.type === 'root') {
        const children = Array.isArray(node.children)
            ? node.children
            : [];

        for (const child of children) {
            renderMarkdownNode(
                child,
                depth,
                blocks
            );
        }

        return;
    }

    // --------------------------------------------------------
    // Content
    // --------------------------------------------------------
    //
    // Content does not consume taxonomy depth.
    //

    if (node.type === 'content') {
        const content = renderContentNodeMarkdown(node);

        if (content) {
            blocks.push(content);
        }

        return;
    }

    // --------------------------------------------------------
    // Taxon
    // --------------------------------------------------------

    if (node.type === 'taxon') {
        if (isSpeciesNode(node)) {
            const speciesMarkdown = renderSpeciesNodeMarkdown(
                node,
                depth
            );

            if (speciesMarkdown) {
                blocks.push(speciesMarkdown);
            }
        } else {
            const taxonMarkdown = renderTaxonNodeMarkdown(
                node,
                depth
            );

            if (taxonMarkdown) {
                blocks.push(taxonMarkdown);
            }
        }

        // ----------------------------------------------------
        // Taxonomy children
        //
        // Only taxonomy nodes consume the next depth.
        // Content nodes keep the same depth.
        // ----------------------------------------------------

        const children = Array.isArray(node.children)
            ? node.children
            : [];

        for (const child of children) {
            const childDepth =
                child && child.type === 'content'
                    ? depth
                    : depth + 1;

            renderMarkdownNode(
                child,
                childDepth,
                blocks
            );
        }

        return;
    }
}


// ============================================================
// 9. Taxon Renderer
// ============================================================

function renderTaxonNodeMarkdown(node, depth) {
    const name = getMarkdownTaxonName(node);

    if (!name) {
        return '';
    }

    return formatMarkdownHeading(
        name,
        depth
    );
}


// ============================================================
// 10. Species Renderer
// ============================================================

function renderSpeciesNodeMarkdown(node, depth) {
    const profile = getProfileSafe(node);

    const commonName = getSpeciesExportName(
        node,
        profile
    );

    if (!commonName) {
        return '';
    }

    const blocks = [];

    // --------------------------------------------------------
    // Species taxonomy heading
    // --------------------------------------------------------

    blocks.push(
        formatMarkdownHeading(
            commonName,
            depth
        )
    );

    // --------------------------------------------------------
    // Scientific name
    // --------------------------------------------------------

    const scientificName =
        formatSpeciesScientificNameMarkdown(profile);

    if (scientificName) {
        blocks.push(scientificName);
    }

    // --------------------------------------------------------
    // Species Profile
    //
    // Current phase:
    //   taxonomy
    //   ecology
    //   morphology
    //   references
    //
    // Photos / album will be inserted later between
    // morphology and references.
    // --------------------------------------------------------

    const profileMarkdown =
        renderSpeciesProfileMarkdown(
            node,
            profile,
            depth
        );

    if (profileMarkdown) {
        blocks.push(profileMarkdown);
    }

    return joinMarkdownBlocks(blocks);
}


// ============================================================
// 11. Content Renderer
// ============================================================
//
// Content is a raw Markdown / HTML fragment.
//
// IMPORTANT:
//   Do NOT call marked.parse()
//   Do NOT call DOMPurify
//   Do NOT modify heading levels
//   Do NOT escape Markdown
// ============================================================

function renderContentNodeMarkdown(node) {
    if (!node || typeof node.html !== 'string') {
        return '';
    }

    return node.html.trim();
}


// ============================================================
// 12. Markdown Heading Helper
// ============================================================
//
// Normal:
//   depth 1 → #
//   depth 2 → ##
//   ...
//   depth 6 → ######
//
// Overflow:
//   depth > 6
//       → **Taxon name**
//
// Never generate H7+.
// ============================================================

function formatMarkdownHeading(text, depth) {
    const safeText = formatTaxonNameForMarkdown(text);

    if (!safeText) {
        return '';
    }

    if (depth <= 0) {
        throw new Error(
            'Markdown export failed: invalid heading depth.'
        );
    }

    if (depth <= 6) {
        return `${'#'.repeat(depth)} ${safeText}`;
    }

    return `**${safeText}**`;
}


// ============================================================
// 13. Taxon Name Helper
// ============================================================
//
// This is system-generated taxonomy text, not user Markdown.
//
// The goal is to prevent a node name from accidentally changing
// the Markdown structure while preserving the visible name.
//
// In this first phase we only protect line breaks.
// More detailed Markdown escaping can be refined separately
// after renderer testing.
// ============================================================

function formatTaxonNameForMarkdown(text) {
    if (typeof text !== 'string') {
        return '';
    }

    return text
        .replace(/\r\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
}


// ============================================================
// 14. Taxon Name Resolution
// ============================================================

function getMarkdownTaxonName(node) {
    if (!node || typeof node !== 'object') {
        return '';
    }

    if (typeof node.name !== 'string') {
        return '';
    }

    return node.name.trim();
}


// ============================================================
// 15. Species Display Name Resolution
// ============================================================
//
// Specification:
//   Species heading uses the Chinese/common name.
//
// Compatibility:
//   New data → profile.commonName
//   Older data → node.name fallback
//
// The fallback does NOT modify the underlying data.
// ============================================================

function getSpeciesExportName(node, profile) {
    if (
        profile &&
        typeof profile.commonName === 'string' &&
        profile.commonName.trim()
    ) {
        return profile.commonName.trim();
    }

    if (
        node &&
        typeof node.name === 'string' &&
        node.name.trim()
    ) {
        return node.name.trim();
    }

    return '';
}


// ============================================================
// 16. Species Scientific Name Formatter
// ============================================================
//
// Uses the already standardized profile fields.
//
// scientificName:
//   Markdown italic
//
// author:
//   normal text
//
// No parentheses.
// ============================================================

// 辅助：将 HTML 学名格式转为 Markdown
function formatScientificNameMarkdown(rawScientificName, author) {
    if (!rawScientificName) return '';
    const html = formatScientificNameWithAuthor(rawScientificName, author || '');
    return html.replace(/<\/?i>/g, '*');
}

function formatSpeciesScientificNameMarkdown(profile) {
    if (!profile || typeof profile !== 'object') return '';
    const scientificName = typeof profile.scientificName === 'string' ? profile.scientificName.trim() : '';
    const author = typeof profile.author === 'string' ? profile.author.trim() : '';
    if (!scientificName) return '';
    return formatScientificNameMarkdown(scientificName, author);
}

// ============================================================
// 17. Markdown Block Joiner
// ============================================================
//
// Blocks are separated by one blank line.
//
// Empty blocks are removed.
// ============================================================

function joinMarkdownBlocks(blocks) {
    if (!Array.isArray(blocks)) {
        return '';
    }

    return blocks
        .filter(block =>
            typeof block === 'string' &&
            block.trim() !== ''
        )
        .map(block => block.trim())
        .join('\n\n');
}

// ============================================================
// 18. Species Profile Section Configuration
// ============================================================
//
// Section order is fixed by Specification v1.0.
//
// The actual Profile fields are NOT hard-coded in the
// recursive taxonomy traversal.
//
// Field definitions come from SPECIES_PROFILE_SCHEMA.
// ============================================================

const SPECIES_PROFILE_SECTION_ORDER = [
    'taxonomy',
    'ecology',
    'morphology'
];

const SPECIES_PROFILE_SECTION_TITLES = {
    taxonomy: '分类学信息',
    ecology: '生态与分布',
    morphology: '形态与讨论',
    references: '参考文献'
};


// ============================================================
// 19. Profile Formatter Registry
// ============================================================
//
// Schema type → formatter
//
// This is the key part of the Schema-driven architecture.
//
// Future fields can reuse an existing type/formatter without
// changing the Profile traversal logic.
// ============================================================

const PROFILE_MARKDOWN_FORMATTERS = {
    list: formatProfileListMarkdown,
    annotation: formatProfileAnnotationMarkdown,
    inline: formatProfileInlineMarkdown,
    structured: formatProfileStructuredMarkdown,
    markdown: formatProfileUserMarkdown,
    'ordered-list': formatProfileOrderedListMarkdown
};


// ============================================================
// 20. Species Profile Renderer
// ============================================================

function renderSpeciesProfileMarkdown(node, profile, speciesDepth) {
    if (!profile || typeof profile !== 'object') {
        return '';
    }

    const profileDepth = speciesDepth + 1;

    const sectionBlocks = [];

    // --------------------------------------------------------
    // 1. Taxonomy
    // --------------------------------------------------------

    const taxonomyMarkdown =
        renderSpeciesProfileSectionMarkdown(
            profile,
            'taxonomy',
            profileDepth
        );

    if (taxonomyMarkdown) {
        sectionBlocks.push(taxonomyMarkdown);
    }

    // --------------------------------------------------------
    // 2. Ecology
    // --------------------------------------------------------

    const ecologyMarkdown =
        renderSpeciesProfileSectionMarkdown(
            profile,
            'ecology',
            profileDepth
        );

    if (ecologyMarkdown) {
        sectionBlocks.push(ecologyMarkdown);
    }

    // --------------------------------------------------------
    // 3. Morphology & Discussion
    // --------------------------------------------------------

    const morphologyMarkdown =
        renderSpeciesProfileSectionMarkdown(
            profile,
            'morphology',
            profileDepth
        );

    if (morphologyMarkdown) {
        sectionBlocks.push(morphologyMarkdown);
    }

    // --------------------------------------------------------
    // 4. Album
    // --------------------------------------------------------
    //
    // Album is NOT a Profile field.
    // It comes directly from node.photos.
    //
    // It is intentionally rendered here rather than being
    // included in SPECIES_PROFILE_SCHEMA.
    // --------------------------------------------------------

    const albumMarkdown =
        renderSpeciesAlbumMarkdown(
            node,
            profileDepth
        );

    if (albumMarkdown) {
        sectionBlocks.push(albumMarkdown);
    }

    // --------------------------------------------------------
    // 5. References
    // --------------------------------------------------------

    const referencesMarkdown =
        renderSpeciesProfileSectionMarkdown(
            profile,
            'references',
            profileDepth
        );

    if (referencesMarkdown) {
        sectionBlocks.push(referencesMarkdown);
    }

    return joinMarkdownBlocks(sectionBlocks);
}


// ============================================================
// 21. Profile Section Renderer
// ============================================================
//
// A Section is emitted only if at least one field inside it
// contains meaningful data.
//
// Section heading:
//   Species depth + 1
//
// If that exceeds H6:
//   bold fallback
//
// Fields themselves never create headings.
// ============================================================

function renderSpeciesProfileSectionMarkdown(
    profile,
    sectionKey,
    sectionDepth
) {
    const sectionFields = SPECIES_PROFILE_SCHEMA.filter(
        field => field.section === sectionKey
    );

    if (sectionFields.length === 0) {
        return '';
    }

    const fieldBlocks = [];

    for (const field of sectionFields) {
        const fieldMarkdown =
            renderProfileFieldMarkdown(
                profile,
                field
            );

        if (fieldMarkdown) {
            fieldBlocks.push(fieldMarkdown);
        }
    }

    // --------------------------------------------------------
    // Empty Section
    // --------------------------------------------------------

    if (fieldBlocks.length === 0) {
        return '';
    }

    const title =
        SPECIES_PROFILE_SECTION_TITLES[sectionKey];

    if (!title) {
        return '';
    }

    const heading =
        formatMarkdownHeading(
            title,
            sectionDepth
        );

    return joinMarkdownBlocks([
        heading,
        ...fieldBlocks
    ]);
}


// ============================================================
// 22. Schema-driven Field Renderer
// ============================================================

function renderProfileFieldMarkdown(profile, field) {
    if (!profile || !field) {
        return '';
    }

    const value = profile[field.key];

    // --------------------------------------------------------
    // Empty value
    // --------------------------------------------------------

    if (!hasMeaningfulMarkdownValue(value)) {
        return '';
    }

    const formatter =
        PROFILE_MARKDOWN_FORMATTERS[field.type];

    if (typeof formatter !== 'function') {
        console.warn(
            `Markdown export: unknown Profile field type "${field.type}" for "${field.key}".`
        );

        return '';
    }

    try {
        return formatter(
            value,
            field
        );
    } catch (error) {
        // A malformed structured field should not make the
        // entire Markdown export fail.
        console.warn(
            `Markdown export: failed to format Profile field "${field.key}".`,
            error
        );

        // Fallback to readable text where possible.
        return formatProfileFallbackMarkdown(
            field,
            value
        );
    }
}


// ============================================================
// 23. Meaningful Value Check
// ============================================================
//
// Specification:
//
// null
// undefined
// ''
// '   '
// []
//
// are empty.
//
// Structured objects are meaningful if they contain usable
// text/link/data.
// ============================================================

function hasMeaningfulMarkdownValue(value) {
    if (value === null || value === undefined) {
        return false;
    }

    if (typeof value === 'string') {
        return value.trim() !== '';
    }

    if (Array.isArray(value)) {
        return value.some(item =>
            hasMeaningfulMarkdownValue(item)
        );
    }

    if (typeof value === 'object') {
        if (
            typeof value.text === 'string' &&
            value.text.trim()
        ) {
            return true;
        }

        if (
            typeof value.link === 'string' &&
            value.link.trim()
        ) {
            return true;
        }

        if (
            typeof value.country === 'string' &&
            value.country.trim()
        ) {
            return true;
        }

        if (
            Array.isArray(value.areas) &&
            value.areas.length > 0
        ) {
            return true;
        }

        if (
            typeof value.coordinate === 'string' &&
            value.coordinate.trim()
        ) {
            return true;
        }

        if (
            typeof value.description === 'string' &&
            value.description.trim()
        ) {
            return true;
        }

        if (
            typeof value.label === 'string' &&
            value.label.trim()
        ) {
            return true;
        }

        if (
            typeof value.value === 'string' &&
            value.value.trim()
        ) {
            return true;
        }

        if (
            Array.isArray(value.months) &&
            value.months.length > 0
        ) {
            return true;
        }

        return false;
    }

    return Boolean(value);
}


// ============================================================
// 24. List Formatter
// ============================================================
//
// Used by:
//   synonyms
//   localities
//
// The formatter detects the structured item shape rather than
// hard-coding Profile recursion by field name.
// ============================================================

function formatProfileListMarkdown(value, field) {
    if (!Array.isArray(value)) {
        return '';
    }

    const items = [];

    for (const item of value) {
        if (!item) {
            continue;
        }

        // ----------------------------------------------------
        // Locality item
        // ----------------------------------------------------

        if (
            typeof item === 'object' &&
            (
                'coordinate' in item ||
                'description' in item
            )
        ) {
            const coordinate =
                typeof item.coordinate === 'string'
                    ? item.coordinate.trim()
                    : '';

            const description =
                typeof item.description === 'string'
                    ? item.description.trim()
                    : '';

            let text = '';

            if (coordinate && description) {
                text = `${coordinate} — ${description}`;
            } else {
                text = coordinate || description;
            }

            if (text) {
                items.push(`- ${text}`);
            }

            continue;
        }

        // ----------------------------------------------------
        // Annotated scientific item
        //
        // Current structure:
        //   { text, link }
        //
        // Used by synonyms.
        // ----------------------------------------------------

        if (
            typeof item === 'object' &&
            (
                'text' in item ||
                'link' in item
            )
        ) {
            const text =
                formatScientificAnnotationMarkdown(item);

            if (text) {
                items.push(`- ${text}`);
            }

            continue;
        }

        // ----------------------------------------------------
        // Simple string fallback
        // ----------------------------------------------------

        if (typeof item === 'string' && item.trim()) {
            items.push(`- ${item.trim()}`);
        }
    }

    if (items.length === 0) {
        return '';
    }

    return joinMarkdownBlocks([
        `**${field.title}**`,
        items.join('\n')
    ]);
}


// ============================================================
// 25. Annotation Formatter
// ============================================================
//
// Used by:
//   protologue
//   typeInformation
//
// Output:
//   **原始发表**：text — [链接]
//
// URL itself is never emitted as the visible link text.
// ============================================================

function formatProfileAnnotationMarkdown(value, field) {
    const annotation =
        formatAnnotationValueMarkdown(value);

    if (!annotation) {
        return '';
    }

    return `**${field.title}**：${annotation}`;
}


// ============================================================
// 26. Inline Formatter
// ============================================================
//
// Used by:
//   distribution
//   habitat
//
// Output:
//   **分布**：中国（云南，西藏）；印度；缅甸
// ============================================================

function formatProfileInlineMarkdown(value, field) {
    if (typeof value !== 'string') {
        return '';
    }

    const text = value.trim();

    if (!text) {
        return '';
    }

    return `**${field.title}**：${text}`;
}


// ============================================================
// 27. Structured Formatter
// ============================================================
//
// Currently used by:
//   phenology
//
// UI-specific month bars are NOT exported.
// Only readable natural-language information is emitted.
// ============================================================

function formatProfileStructuredMarkdown(value, field) {
    if (!Array.isArray(value)) {
        return '';
    }

    const entries = [];

    for (const item of value) {
        if (!item || typeof item !== 'object') {
            if (
                typeof item === 'string' &&
                item.trim()
            ) {
                entries.push(item.trim());
            }

            continue;
        }

        const label =
            typeof item.label === 'string'
                ? item.label.trim()
                : '';

        const rawValue =
            typeof item.value === 'string'
                ? item.value.trim()
                : '';

        let text = '';

        if (label && rawValue) {
            text = `${label}${rawValue}`;
        } else if (rawValue) {
            text = rawValue;
        } else if (label) {
            text = label;
        }

        // ----------------------------------------------------
        // Fallback:
        // If structured data has no textual value but contains
        // months, create a readable month expression.
        // ----------------------------------------------------

        if (
            !text &&
            Array.isArray(item.months) &&
            item.months.length
        ) {
            text = formatPhenologyMonthsMarkdown(
                item.months
            );

            if (label && text) {
                text = `${label}${text}`;
            }
        }

        if (text) {
            entries.push(text);
        }
    }

    if (entries.length === 0) {
        return '';
    }

    return `**${field.title}**：${entries.join('；')}`;
}


// ============================================================
// 28. User Markdown Formatter
// ============================================================
//
// Used by:
//   diagnosis
//   description
//   discussion
//
// CRITICAL:
//
// Do NOT:
//   marked.parse()
//   DOMPurify
//   escape Markdown
//   modify heading levels
//
// User Markdown must remain unchanged.
// ============================================================

function formatProfileUserMarkdown(value, field) {
    if (typeof value !== 'string') {
        return '';
    }

    const text = value.trim();

    if (!text) {
        return '';
    }

    return joinMarkdownBlocks([
        `**${field.title}**`,
        text
    ]);
}


// ============================================================
// 29. Ordered List Formatter
// ============================================================
//
// Used by:
//   references
//
// Output:
//
// **参考文献**
//
// 1. 文献...
// 2. 文献...
// ============================================================

function formatProfileOrderedListMarkdown(value, field) {
    if (!Array.isArray(value)) {
        return '';
    }

    const items = [];

    for (const item of value) {
        if (!item) {
            continue;
        }

        let text = '';

        if (
            typeof item === 'object' &&
            (
                'text' in item ||
                'link' in item
            )
        ) {
            text =
                formatPlainAnnotationMarkdown(item);
        } else if (
            typeof item === 'string'
        ) {
            text = item.trim();
        }

        if (text) {
            items.push(text);
        }
    }

    if (items.length === 0) {
        return '';
    }

    const orderedList = items
        .map((item, index) =>
            `${index + 1}. ${item}`
        )
        .join('\n');

    return orderedList;
}


// ============================================================
// 30. Scientific Annotation Formatter
// ============================================================
//
// Used by synonym entries.
//
// Example:
//
// {
//     text: 'Carlemannia henryi H.Lév.',
//     link: 'https://...'
// }
//
// →
//
// *Carlemannia henryi* H.Lév. — [链接]
// ============================================================

function formatScientificAnnotationMarkdown(item) {
    if (!item || typeof item !== 'object') {
        return '';
    }

    const rawText =
        typeof item.text === 'string'
            ? item.text.trim()
            : '';

    const link =
        typeof item.link === 'string'
            ? item.link.trim()
            : '';

    if (!rawText && !link) {
        return '';
    }

    let visibleText = '';

    if (rawText) {
        const parsed = parseScientificName(rawText);

        if (parsed && parsed.scientificName) {
            visibleText = formatScientificNameMarkdown(parsed.scientificName, parsed.author || '');
        } else {
            visibleText = rawText;
        }
    }

    if (!visibleText && link) {
        return `[链接](${link})`;
    }

    if (link) {
        return `${visibleText} — [链接](${link})`;
    }

    return visibleText;
}


// ============================================================
// 31. Plain Annotation Formatter
// ============================================================
//
// Used by references.
//
// Reference text is NOT user Markdown and therefore should not
// be interpreted as a scientific-name expression.
// ============================================================

function formatPlainAnnotationMarkdown(item) {
    if (!item || typeof item !== 'object') {
        return '';
    }

    const text =
        typeof item.text === 'string'
            ? item.text.trim()
            : '';

    const link =
        typeof item.link === 'string'
            ? item.link.trim()
            : '';

    if (!text && !link) {
        return '';
    }

    if (!text) {
        return `[链接](${link})`;
    }

    if (!link) {
        return text;
    }

    return `${text} — [链接](${link})`;
}


// ============================================================
// 32. Generic Annotation Formatter
// ============================================================
//
// Used by protologue / typeInformation.
// ============================================================

function formatAnnotationValueMarkdown(value) {
    if (
        !value ||
        typeof value !== 'object'
    ) {
        if (
            typeof value === 'string' &&
            value.trim()
        ) {
            return value.trim();
        }

        return '';
    }

    const text =
        typeof value.text === 'string'
            ? value.text.trim()
            : '';

    const link =
        typeof value.link === 'string'
            ? value.link.trim()
            : '';

    if (!text && !link) {
        return '';
    }

    if (!text) {
        return `[链接](${link})`;
    }

    if (!link) {
        return text;
    }

    return `${text} — [链接](${link})`;
}


// ============================================================
// 33. Phenology Month Fallback Formatter
// ============================================================

function formatPhenologyMonthsMarkdown(months) {
    if (!Array.isArray(months)) {
        return '';
    }

    const validMonths = months
        .map(Number)
        .filter(month =>
            Number.isInteger(month) &&
            month >= 1 &&
            month <= 12
        );

    if (validMonths.length === 0) {
        return '';
    }

    const uniqueMonths = [...new Set(validMonths)]
        .sort((a, b) => a - b);

    // --------------------------------------------------------
    // Convert consecutive months to ranges.
    //
    // [7, 8, 9]
    //     → 7–9月
    //
    // [7, 9]
    //     → 7月、9月
    // --------------------------------------------------------

    const ranges = [];

    let start = uniqueMonths[0];
    let previous = uniqueMonths[0];

    for (let i = 1; i < uniqueMonths.length; i++) {
        const current = uniqueMonths[i];

        if (current === previous + 1) {
            previous = current;
            continue;
        }

        ranges.push(
            start === previous
                ? `${start}月`
                : `${start}–${previous}月`
        );

        start = current;
        previous = current;
    }

    ranges.push(
        start === previous
            ? `${start}月`
            : `${start}–${previous}月`
    );

    return ranges.join('、');
}


// ============================================================
// 34. Profile Fallback Formatter
// ============================================================
//
// Structured-field formatting failures are non-fatal.
//
// Prefer readable text over aborting the export.
// ============================================================

function formatProfileFallbackMarkdown(field, value) {
    if (!field) {
        return '';
    }

    if (typeof value === 'string') {
        const text = value.trim();

        if (text) {
            return `**${field.title}**：${text}`;
        }

        return '';
    }

    if (Array.isArray(value)) {
        const readable = value
            .map(item => {
                if (
                    typeof item === 'string'
                ) {
                    return item.trim();
                }

                if (
                    item &&
                    typeof item === 'object'
                ) {
                    if (
                        typeof item.text === 'string' &&
                        item.text.trim()
                    ) {
                        return item.text.trim();
                    }

                    if (
                        typeof item.description === 'string' &&
                        item.description.trim()
                    ) {
                        return item.description.trim();
                    }

                    if (
                        typeof item.coordinate === 'string' &&
                        item.coordinate.trim()
                    ) {
                        return item.coordinate.trim();
                    }
                }

                return '';
            })
            .filter(Boolean);

        if (readable.length) {
            return joinMarkdownBlocks([
                `**${field.title}**`,
                readable
                    .map(item => `- ${item}`)
                    .join('\n')
            ]);
        }
    }

    return '';
}

// ============================================================
// 35. Species Album Renderer
// ============================================================
//
// Album is stored on node.photos rather than taxonProfiles.
//
// Current phase:
//   Generate Markdown image references only.
//
// ZIP / physical image export will be implemented later.
// ============================================================

function renderSpeciesAlbumMarkdown(node, sectionDepth) {
    if (!node || !Array.isArray(node.photos)) {
        return '';
    }

    if (node.photos.length === 0) {
        return '';
    }

    const imageBlocks = [];

    for (const photo of node.photos) {
        const imageMarkdown =
            formatSpeciesPhotoMarkdown(photo);

        if (imageMarkdown) {
            imageBlocks.push(imageMarkdown);
        }
    }

    // --------------------------------------------------------
    // Do not create an empty Album section.
    // --------------------------------------------------------

    if (imageBlocks.length === 0) {
        return '';
    }

    const heading =
        formatMarkdownHeading(
            '相册',
            sectionDepth
        );

    return joinMarkdownBlocks([
        heading,
        ...imageBlocks
    ]);
}

// ============================================================
// 36. Species Photo Markdown Reference
// ============================================================
//
// This function ONLY creates the Markdown reference from
// information already available on the photo object.
//
// It does NOT:
//   - access IndexedDB
//   - fetch external URLs
//   - create Blobs
//   - generate ZIP files
//
// Resource resolution will be handled by the next image
// export layer.
// ============================================================

function formatSpeciesPhotoMarkdown(photo) {
    if (!photo || typeof photo !== 'object') {
        return '';
    }

    const caption =
        getSpeciesPhotoCaption(photo);

    // --------------------------------------------------------
    // IndexedDB image reference
    // --------------------------------------------------------

    if (
        photo.isImageRef === true &&
        typeof photo.uuid === 'string' &&
        photo.uuid.trim()
    ) {
        const uuid = photo.uuid.trim();

        const extension =
            getSpeciesPhotoExtension(photo);

        const filename =
            extension
                ? `${uuid}.${extension}`
                : `${uuid}.bin`;

        return `![${caption}](images/${filename})`;
    }

    // --------------------------------------------------------
    // External URL image
    // --------------------------------------------------------

    const externalUrl =
        getSpeciesPhotoExternalUrl(photo);

    if (externalUrl) {
        return `![${caption}](${externalUrl})`;
    }

    return '';
}

// ============================================================
// 37. Photo Caption Resolver
// ============================================================

function getSpeciesPhotoCaption(photo) {
    if (
        photo &&
        typeof photo.caption === 'string'
    ) {
        return photo.caption.trim();
    }

    return '';
}

// ============================================================
// 37. External Species Photo URL Resolver
// ============================================================

function getSpeciesPhotoExternalUrl(photo) {
    if (!photo || typeof photo !== 'object') {
        return '';
    }

    const candidates = [
        photo.url,
        photo.src,
        photo.dataSrc
    ];

    for (const value of candidates) {
        if (
            typeof value === 'string' &&
            value.trim()
        ) {
            const url = value.trim();

            // Ignore internal placeholder/data URLs here.
            if (
                url.startsWith('http://') ||
                url.startsWith('https://')
            ) {
                return url;
            }
        }
    }

    return '';
}

// ============================================================
// 38. MIME → File Extension
// ============================================================

function getImageExtensionFromMimeType(mimeType) {
    if (
        typeof mimeType !== 'string'
    ) {
        return '';
    }

    const normalized =
        mimeType
            .trim()
            .toLowerCase();

    const MIME_EXTENSION_MAP = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/avif': 'avif',
        'image/bmp': 'bmp',
        'image/tiff': 'tif'
    };

    return MIME_EXTENSION_MAP[
        normalized
    ] || '';
}

// ============================================================
// 39. Photo Extension Resolver
// ============================================================

function getSpeciesPhotoExtension(photo) {
    if (!photo || typeof photo !== 'object') {
        return '';
    }

    // --------------------------------------------------------
    // 1. Explicit extension
    // --------------------------------------------------------

    if (
        typeof photo.extension === 'string' &&
        photo.extension.trim()
    ) {
        return photo.extension
            .trim()
            .toLowerCase()
            .replace(/^\./, '');
    }

    // --------------------------------------------------------
    // 2. MIME type
    // --------------------------------------------------------

    if (
        typeof photo.mimeType === 'string'
    ) {
        const extension =
            getImageExtensionFromMimeType(
                photo.mimeType
            );

        if (extension) {
            return extension;
        }
    }

    if (
        typeof photo.type === 'string' &&
        photo.type.startsWith('image/')
    ) {
        const extension =
            getImageExtensionFromMimeType(
                photo.type
            );

        if (extension) {
            return extension;
        }
    }

    // --------------------------------------------------------
    // 3. Filename
    // --------------------------------------------------------

    if (
        typeof photo.filename === 'string'
    ) {
        const match =
            photo.filename
                .trim()
                .match(/\.([a-z0-9]+)$/i);

        if (match) {
            return match[1].toLowerCase();
        }
    }

    // --------------------------------------------------------
    // No reliable extension yet.
    //
    // The ZIP assembly phase will be stricter because the
    // physical Blob MIME type must eventually determine the
    // exported filename.
    // --------------------------------------------------------

    return '';
}

// ============================================================
// Image Export Request
// ============================================================

function createSpeciesPhotoExportRequest(photo) {
    if (!photo || typeof photo !== 'object') {
        return null;
    }

    // --------------------------------------------------------
    // IndexedDB / internal image
    // --------------------------------------------------------

    if (
        photo.isImageRef === true &&
        typeof photo.uuid === 'string' &&
        photo.uuid.trim()
    ) {
        return {
            source: 'indexeddb',
            uuid: photo.uuid.trim(),
            caption: getSpeciesPhotoCaption(photo)
        };
    }

    // --------------------------------------------------------
    // External image URL
    // --------------------------------------------------------

    if (
        photo.isImageRef === false &&
        typeof photo.src === 'string' &&
        /^https?:\/\//i.test(photo.src.trim())
    ) {
        return {
            source: 'external',
            url: photo.src.trim(),
            caption: getSpeciesPhotoCaption(photo)
        };
    }

    return null;
}

// ============================================================
// Collect Species Photo Export Requests
// ============================================================

function collectSpeciesPhotoExportRequests(node) {
    if (
        !node ||
        node.type !== 'taxon' ||
        !isSpeciesNode(node) ||
        !Array.isArray(node.photos)
    ) {
        return [];
    }

    const requests = [];

    for (const photo of node.photos) {
        const request =
            createSpeciesPhotoExportRequest(photo);

        if (request) {
            requests.push(request);
        }
    }

    return requests;
}

// ============================================================
// Collect Image Export Requests from Tree
// ============================================================

function collectImageExportRequests(rootNode) {
    const requests = [];

    function visit(node) {
        if (!node) {
            return;
        }

        // ----------------------------------------------------
        // Species
        // ----------------------------------------------------

        if (
            node.type === 'taxon' &&
            isSpeciesNode(node)
        ) {
            requests.push(
                ...collectSpeciesPhotoExportRequests(node)
            );
        }

        // ----------------------------------------------------
        // Children
        // ----------------------------------------------------

        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                visit(child);
            }
        }
    }

    visit(rootNode);

    return requests;
}

// ============================================================
// Resolve IndexedDB Image
// ============================================================

async function resolveIndexedDBImageForExport(request) {
    if (
        !request ||
        request.source !== 'indexeddb' ||
        !request.uuid
    ) {
        return null;
    }

    const blob =
        await getImageFromDB(request.uuid);

    if (!blob) {
        return {
            source: 'indexeddb',
            uuid: request.uuid,
            success: false,
            blob: null,
            filename: null,
            markdownPath: null,
            warning:
                `IndexedDB image not found: ${request.uuid}`
        };
    }

    const extension =
        getImageExtensionFromMimeType(
            blob.type
        ) || 'bin';

    const filename =
        `${request.uuid}.${extension}`;

    return {
        source: 'indexeddb',
        uuid: request.uuid,
        success: true,
        blob,
        filename,
        markdownPath: `images/${filename}`,
        warning: null
    };
}

// ============================================================
// Resolve External Image
// ============================================================

async function resolveExternalImageForExport(
    request,
    index
) {
    if (
        !request ||
        request.source !== 'external' ||
        !request.url
    ) {
        return null;
    }

    try {
        const response =
            await fetch(request.url);

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const blob =
            await response.blob();

        const extension =
            getImageExtensionFromMimeType(
                blob.type
            ) || 'bin';

        const filename =
            `external-${String(index + 1).padStart(3, '0')}.${extension}`;

        return {
            source: 'external',
            url: request.url,
            success: true,
            blob,
            filename,
            markdownPath:
                `images/${filename}`,
            warning: null
        };

    } catch (error) {

        return {
            source: 'external',
            url: request.url,
            success: false,
            blob: null,
            filename: null,
            markdownPath: request.url,
            warning:
                `External image download failed: ${request.url}`
        };
    }
}

// ============================================================
// Resolve All Export Images
// ============================================================

async function resolveExportImages(requests, onProgress = null) {
    if (!Array.isArray(requests)) {
        return { images: [], warnings: [] };
    }

    const results = [];
    const warnings = [];
    const total = requests.length;

    if (total === 0) {
        return { images: [], warnings: [] };
    }

    // 并发控制：同时处理 5 个
    const concurrency = 5;
    let completedCount = 0;
    let externalIndex = 0;

    // 安全触发进度
    const emitProgress = (current, totalCount) => {
        if (onProgress && typeof onProgress === 'function') {
            try {
                onProgress(current, totalCount);
            } catch (e) {
                // 忽略回调中的错误
            }
        }
    };

    // 处理单个请求的函数
    const processRequest = async (request) => {
        if (request.source === 'indexeddb') {
            return await resolveIndexedDBImageForExport(request);
        } else if (request.source === 'external') {
            // 注意：闭包捕获当前 externalIndex，但因并发执行，序号可能不连续
            const idx = externalIndex++;
            return await resolveExternalImageForExport(request, idx);
        }
        return null;
    };

    // 分批并发执行
    for (let i = 0; i < requests.length; i += concurrency) {
        const batch = requests.slice(i, i + concurrency);
        const batchPromises = batch.map((request) => processRequest(request));

        // 等待当前批次全部完成
        const batchResults = await Promise.all(batchPromises);

        // 收集结果并更新进度
        for (const result of batchResults) {
            if (result) {
                results.push(result);
                if (result.warning) {
                    warnings.push(result.warning);
                }
            }
            completedCount++;
            // 每完成一张图就报告一次进度
            emitProgress(completedCount, total);
        }
    }

    return { images: results, warnings };
}

// ============================================================
// Rewrite Markdown Image Paths
// ============================================================

function rewriteMarkdownImagePaths(markdown, resolvedImages) {
    if (
        typeof markdown !== 'string' ||
        !resolvedImages ||
        !Array.isArray(resolvedImages.images)
    ) {
        return markdown;
    }

    let result = markdown;

    for (const image of resolvedImages.images) {

        if (!image.success || !image.markdownPath) {
            continue;
        }

        // ----------------------------------------------------
        // IndexedDB image
        // Current Markdown path:
        // images/<uuid>
        // ----------------------------------------------------

        if (
            image.source === 'indexeddb' &&
            image.uuid
        ) {
            const oldPath =
                `images/${image.uuid}.bin`;

            result = result.split(oldPath).join(
                image.markdownPath
            );

            continue;
        }

        // ----------------------------------------------------
        // External image
        // Current Markdown path:
        // original URL
        // ----------------------------------------------------

        if (
            image.source === 'external' &&
            image.url
        ) {
            result = result.split(image.url).join(
                image.markdownPath
            );
        }
    }

    return result;
}

function buildImageExportManifest(resolvedImages) {
    if (
        !resolvedImages ||
        !Array.isArray(resolvedImages.images)
    ) {
        return [];
    }

    return resolvedImages.images
        .filter(image => image && image.success)
        .map(image => ({
            source: image.source,
            uuid: image.uuid || null,
            url: image.url || null,
            filename: image.filename || null,
            markdownPath: image.markdownPath || null
        }));
}

async function buildMarkdownZip({
    markdown,
    resolved,
    onProgress = null
}) {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip is not available.');
    }

    if (typeof markdown !== 'string') {
        throw new Error('Markdown content is required.');
    }

    const zip = new JSZip();

    // --------------------------------------------------------
    // 1. Markdown
    // --------------------------------------------------------

    zip.file(
        'README.md',
        markdown
    );

    // --------------------------------------------------------
    // 2. Images
    // --------------------------------------------------------

    if (
        resolved &&
        Array.isArray(resolved.images)
    ) {
        for (const image of resolved.images) {

            if (
                !image ||
                !image.success ||
                !image.blob ||
                !image.filename
            ) {
                continue;
            }

            zip.file(
                `images/${image.filename}`,
                image.blob
            );
        }
    }

    // --------------------------------------------------------
    // 3. Generate ZIP
    // --------------------------------------------------------

    const blob =
        await zip.generateAsync({
            type: 'blob',
            onProgress: (metadata) => {
                if (onProgress && typeof onProgress === 'function') {
                    // metadata.percent 是 0-100 的压缩进度
                    try {
                        onProgress(metadata.percent);
                    } catch (e) {}
                }
            }
        });

    return blob;
}

async function exportMarkdownPackage(options = {}) {
    // 提取进度回调
    const { onProgress, ...restOptions } = options;

    // 辅助函数：安全触发进度
    const emitProgress = (stage, value) => {
        if (onProgress && typeof onProgress === 'function') {
            try { onProgress({ stage, value }); } catch (e) {}
        }
    };

    // 1. 解析根
    const root = resolveMarkdownExportRoot(restOptions);
    emitProgress('root_resolved', 0);

    // 2. 渲染 Markdown
    const result = exportMarkdown(restOptions);
    emitProgress('markdown_rendered', 10);

    // 3. 收集图片请求
    const requests = collectImageExportRequests(root.rootNode);
    const totalImages = requests.length;
    emitProgress('images_collected', { total: totalImages });

    // 4. 解析图片（传入进度回调）
    const resolved = await resolveExportImages(requests, (current, total) => {
        // 将图片解析进度映射为总体进度（10% ~ 70%）
        const percent = 10 + (current / total) * 60;
        emitProgress('images_resolving', { current, total, percent });
    });

    // 5. 重写 Markdown 路径
    const markdown = rewriteMarkdownImagePaths(result.markdown, resolved);
    emitProgress('paths_rewritten', 75);

    // 6. 构建 ZIP（传入压缩进度回调）
    const blob = await buildMarkdownZip({
        markdown,
        resolved,
        onProgress: (percent) => {
            // 压缩阶段占 75% ~ 100%
            const overallPercent = 75 + (percent / 100) * 25;
            emitProgress('zipping', { percent: overallPercent });
        }
    });

    emitProgress('done', 100);

    return {
        blob,
        markdown,
        manifest: buildImageExportManifest(resolved),
        warnings: resolved.warnings || []
    };
}
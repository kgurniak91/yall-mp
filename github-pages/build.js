const Mustache = require('mustache');
const fs = require('fs-extra');
const path = require('path');

// Paths
const SRC_DIR = path.join(__dirname, 'src');
const DATA_DIR = path.join(__dirname, 'locales');
const OUT_DIR = path.join(__dirname, '../docs');

// Helper to load partials
const loadPartial = (name) => fs.readFileSync(path.join(SRC_DIR, 'partials', `${name}.mustache`), 'utf8');

const partials = {
  head: loadPartial('head'),
  header: loadPartial('header'),
  footer: loadPartial('footer'),
  scripts: loadPartial('scripts')
};

// Helper to load pages
const loadPage = (name) => fs.readFileSync(path.join(SRC_DIR, 'pages', `${name}.mustache`), 'utf8');

const pages = [
  {name: 'index', template: loadPage('index')},
  {name: 'anki', template: loadPage('anki')},
  {name: 'dictionaries', template: loadPage('dictionaries')}
];

// Helper to render pages
const renderPage = async (layout, pageName, templateStr, data, outputPath) => {
  const pageContent = Mustache.render(templateStr, data);
  const fullHtml = Mustache.render(layout, {
    ...data,
    content: pageContent,
    buildTimestamp: new Date().toUTCString()
  }, partials);
  await fs.outputFile(outputPath, fullHtml);
  console.log(`* Generated page: ${outputPath}`);
};

// Helper to build pages
const buildPages = async (layout, dataObj, langSubfolder = '') => {
  for (const page of pages) {
    // Prepare copy of page data
    const pageData = JSON.parse(JSON.stringify(dataObj));

    // Merge page-specific meta
    const pageSpecificMeta = pageData[`${page.name}_meta`] || {};
    pageData.meta = {
      ...pageData.meta,
      ...pageSpecificMeta
    };

    // Set dynamic language switcher link
    const switchLink = langSubfolder === 'pl'
      ? `../${page.name}.html`
      : `pl/${page.name}.html`;

    pageData.lang_switch = {
      ...pageData.lang_switch,
      link: switchLink
    };

    // Set navigation links for subpages
    if (page.name !== 'index') {
      pageData.navigation = pageData.navigation.map(navItem => {
        if (navItem.link.startsWith('#')) {
          return {
            ...navItem,
            link: `index.html${navItem.link}`
          };
        }
        return navItem;
      });
    }

    // Render page
    const outputPath = path.join(OUT_DIR, langSubfolder, `${page.name}.html`);
    await renderPage(layout, page.name, page.template, pageData, outputPath);
  }
};

async function build() {
  console.log('Starting build process...');

  // Ensure output directories exist
  await fs.ensureDir(OUT_DIR);
  await fs.ensureDir(path.join(OUT_DIR, 'pl'));

  // Load data
  const layout = fs.readFileSync(path.join(SRC_DIR, 'layout.mustache'), 'utf8');
  const enData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'en.json'), 'utf8'));
  const plData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pl.json'), 'utf8'));

  // Build English version
  console.log('\nBuilding English website...');
  await buildPages(layout, enData);

  // Build Polish version
  console.log('\nBuilding Polish website...');
  await buildPages(layout, plData, 'pl');

  console.log('\nBuild complete!');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

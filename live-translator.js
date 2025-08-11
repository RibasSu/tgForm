const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

class LiveTranslator {
  constructor(options) {
    this.localesDir = options.localesDir || './locales';
    this.defaultLang = options.defaultLang || 'en';
    this.lang = this.defaultLang;
    this.namespace = options.namespace || 'translation';
    this.translations = {};
    this.loadAllLanguages();
    this.watchFiles();
  }

  setLanguage(lang) {
    if (this.translations[lang]) {
      this.lang = lang;
    } else {
      console.warn(`Language "${lang}" not found. Retaining ${this.lang}.`);
    }
  }

  t(key) {
    return this.translations[this.lang]?.[key] ||
           this.translations[this.defaultLang]?.[key] ||
           key;
  }

  parseJson(fileData) {
    const langs = Object.keys(fileData);
    if (langs.length === 1 && typeof fileData[langs[0]] === 'object') {
      const nsData = fileData[langs[0]][this.namespace];
      if (nsData && typeof nsData === 'object') {
        return { lang: langs[0], data: nsData };
      }
    }
    return null;
  }

  loadAllLanguages() {
    const files = fs.readdirSync(this.localesDir);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        try {
          const jsonData = JSON.parse(fs.readFileSync(path.join(this.localesDir, file), 'utf8'));
          const parsed = this.parseJson(jsonData);
          if (parsed) {
            this.translations[parsed.lang] = parsed.data;
          } else {
            const lang = path.basename(file, '.json');
            this.translations[lang] = jsonData;
          }
          console.log(`Loaded: ${file}`);
        } catch (err) {
          console.error(`Error loading ${file}:`, err);
        }
      }
    });
  }

  reloadLanguage(langFile) {
    const file = path.join(this.localesDir, langFile);
    if (fs.existsSync(file)) {
      try {
        const jsonData = JSON.parse(fs.readFileSync(file, 'utf8'));
        const parsed = this.parseJson(jsonData);
        if (parsed) {
          this.translations[parsed.lang] = parsed.data;
        } else {
          const lang = path.basename(file, '.json');
          this.translations[lang] = jsonData;
        }
        console.log(`Language reloaded: ${langFile}`);
      } catch (err) {
        console.error(`Error reloading ${langFile}:`, err);
      }
    }
  }

  watchFiles() {
    chokidar.watch(this.localesDir).on('change', (changedPath) => {
      const fileName = path.basename(changedPath);
      this.reloadLanguage(fileName);
    });
  }
}

module.exports = LiveTranslator;
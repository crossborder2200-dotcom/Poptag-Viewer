(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const LANGUAGE_STORAGE_KEY = "poptag-viewer-language";
  const TRANSLATIONS = typeof POPTAG_TRANSLATIONS === "object" ? POPTAG_TRANSLATIONS : {};
  let currentLanguage = (() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === "KR" || saved === "EN") return saved;
    } catch (_error) {}
    const browserLanguage = String(navigator.languages?.[0] || navigator.language || "").toLocaleLowerCase();
    return browserLanguage === "ko" || browserLanguage.startsWith("ko-") ? "KR" : "EN";
  })();
  const t = (key, values = {}) => {
    const entry = TRANSLATIONS[key];
    const template = entry?.[currentLanguage] ?? entry?.KR ?? key;
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => Object.hasOwn(values, name) ? values[name] : match);
  };
  const numberLocale = () => currentLanguage === "KR" ? "ko-KR" : "en-US";
  const formatNumber = value => Number(value).toLocaleString(numberLocale());
  const SLOT_SIZE = 148;
  const MOVEMENT_WIDTH = 640;
  const MOVEMENT_HEIGHT = 360;
  const MOVEMENT_SPEED = 216;
  const MOVEMENT_FACE_FORWARD_DELAY = 3000;
  const MOVEMENT_RENDER_SCALES = new Set([1, 1.5, 2]);
  const DEFAULT_MOVEMENT_RENDER_SCALE = 2;
  const FIELD_BOMB_LIMIT = 6;
  const FIELD_BOMB_FUSE = 3000;
  const FIELD_CHAIN_WINDOW = 2500;
  const FIELD_BOMB_FRAME_DURATION = 180;
  const FIELD_FIRE_TICK = 30;
  const FIELD_FIRE_DURATION = 570;
  const FIELD_FIRE_POWER = 2;
  const ID_DECO_WIDTH = 380;
  const ID_DECO_HEIGHT = 88;
  const ID_DECO_CELL_WIDTH = 182;
  const ID_DECO_GAP = 16;
  // CPortraitWnd draws the game ID decoration at slot (-7, -5), while its
  // PortraitSlot child is positioned at the slot origin. The portrait is
  // therefore (+7, +5) from the decoration's authored draw point.
  const ID_DECO_PORTRAIT_OFFSET = [7, 5];
  const ID_DECO_CATEGORY = "id_deco";
  const BOMB_CATEGORY = "bomb";
  const CHARACTER_DRAW_POINT = [37, 119];
  const DEFAULT_FRAME_DURATION = 120;
  const MAX_GIF_DURATION = 12000;
  const DEFAULT_CHARACTER_SLOT = 5;
  const CACHE_LIMIT = 192;
  const baseLabels = {background:"category.background", flag:"category.flag", prop:"category.prop", effect:"category.effect"};
  const costumeLabels = {expression:"category.expression", hair:"category.hair", head:"category.head", mask:"category.mask", outfit:"category.outfit", accessory:"category.accessory", wing:"category.wing", special:"category.special"};
  const extraLabels = {[ID_DECO_CATEGORY]:"category.id_deco", [BOMB_CATEGORY]:"category.bomb"};
  const categoryLabels = {...baseLabels, ...costumeLabels, ...extraLabels};
  const categoryLabel = key => t(categoryLabels[key]);
  const baseCategories = Object.keys(baseLabels);
  const costumeCategories = Object.keys(costumeLabels);
  const movementDirections = ["down", "right", "up", "left"];
  const movementDirectionByKey = new Map([["ArrowDown","down"],["ArrowRight","right"],["ArrowUp","up"],["ArrowLeft","left"]]);
  const extraCategories = Object.keys(extraLabels);
  const costumeInheritance = new Map([[10,4],[11,7],[12,6],[14,0],[15,8],[17,2],[18,1],[25,9],[27,19],[28,26],[29,16]]);
  // Webpage.exe applies these hue/lightness/saturation adjustments while it
  // decodes every LayerAdjust resource. The three tables live at 0x987250,
  // 0x987298 and 0x9872E0 and are consumed by the HSL routine at 0x787FB0.
  const characterColors = [
    ["red", "color.red", [0, 0, 0]], ["yellow", "color.yellow", [45, 5, 0]],
    ["orange", "color.orange", [27, 5, 20]], ["green", "color.green", [128, 0, -50]],
    ["cyan", "color.cyan", [-178, 0, -30]], ["blue", "color.blue", [-155, 0, 0]],
    ["purple", "color.purple", [-77, 0, 0]], ["pink", "color.pink", [-40, 0, 0]],
  ];
  const characterColorAdjustments = new Map(characterColors.map(([key, _name, adjustment]) => [key, adjustment]));
  const catalogByCategory = new Map(baseCategories.map(category => [category, CATALOG.filter(row => row.category === category)]));
  const costumesByCategory = new Map(costumeCategories.map(category => [category, COSTUMES.filter(row => row.category === category)]));
  const costumeByKey = new Map(COSTUMES.map(row => [row.key, row]));
  const idDecorations = Array.isArray(ID_DECOS) ? ID_DECOS : [];
  const idDecoByKey = new Map(idDecorations.map(row => [row.key, row]));
  const idDecoByCode = new Map(idDecorations.map(row => [row.code, row]));
  const bombs = Array.isArray(BOMBS) ? BOMBS : [];
  const bombByKey = new Map(bombs.map(row => [row.key, row]));
  const bombByCode = new Map(bombs.map(row => [row.code, row]));
  const characterBySlot = new Map(CHARACTERS.map(row => [row.code, row]));
  function characterName(characterOrCode) {
    const character = typeof characterOrCode === "object" ? characterOrCode : characterBySlot.get(Number(characterOrCode));
    if (!character) return String(characterOrCode ?? "");
    return TRANSLATIONS[`character.name.${character.code}`]?.[currentLanguage] ?? rowLabel(character);
  }
  const grid = $("#grid");
  const search = $("#search");
  const sort = $("#sort");
  const characterFilter = $("#character-filter");
  const viewer = $("#viewer");
  let category = "background";
  let resourceStore = null;
  let previewObserver = null;
  let previewGeneration = 0;
  const previewAnimations = new Map();
  let modalAnimation = null;
  let composerAnimation = null;
  let idDecoAnimation = null;
  let movementAnimation = null;
  let lastAnimationTick = 0;
  const heldMovementDirections = new Set();
  let movementDirectionOrder = [];
  const movementState = {x:MOVEMENT_WIDTH / 2, y:Math.round(MOVEMENT_HEIGHT * .64), direction:"down", moving:false, walkStarted:0, lastDirectionInputAt:performance.now()};
  let movementRenderScale = DEFAULT_MOVEMENT_RENDER_SCALE;
  let movementBombs = [];
  let nextMovementBombId = 1;
  let nextMovementBombState = 0;

  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;"}[character]));
  const rowLabel = row => row.item_names?.length ? row.item_names.join(" / ") : t("resource.unnamed");
  const rowResource = row => row.category === ID_DECO_CATEGORY ? `${row.lobby_resource} / ${row.game_resource}` : row.render_resource || row.resource;
  const rowsForCategory = value => baseCategories.includes(value) ? (catalogByCategory.get(value) || []) : costumeCategories.includes(value) ? (costumesByCategory.get(value) || []) : value === ID_DECO_CATEGORY ? idDecorations : value === BOMB_CATEGORY ? bombs : [];
  const rowPrefix = row => ({background:"BG", flag:"FLAG", prop:"PROP", effect:"FX", expression:"FACE", hair:"HAIR", head:"HEAD", mask:"MASK", outfit:"OUTFIT", accessory:"ACC", wing:"WING", special:"SPECIAL", id_deco:"ID", bomb:"BOMB"}[row.category] || row.category.toUpperCase());
  const rowCode = row => `${rowPrefix(row)} ${String(row.code).padStart(4, "0")}`;

  function applyStaticTranslations() {
    document.documentElement.lang = currentLanguage === "KR" ? "ko" : "en";
    document.querySelectorAll("[data-i18n]").forEach(element => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(element => { element.placeholder = t(element.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach(element => { element.setAttribute("aria-label", t(element.dataset.i18nAria)); });
    document.querySelectorAll("[data-i18n-title]").forEach(element => { element.title = t(element.dataset.i18nTitle); });
    document.querySelectorAll("[data-language]").forEach(button => {
      const active = button.dataset.language === currentLanguage;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const idDecoListButton = $("#id-deco-list-button");
    if (idDecoListButton) {
      const title = t("category.list", {category:categoryLabel(ID_DECO_CATEGORY)});
      idDecoListButton.setAttribute("aria-label", title);
      idDecoListButton.title = title;
    }
  }

  function setLanguage(nextLanguage) {
    if (!new Set(["KR", "EN"]).has(nextLanguage) || nextLanguage === currentLanguage) return;
    const pickerState = composerPickerState();
    currentLanguage = nextLanguage;
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage); }
    catch (_error) { /* Language persistence is optional. */ }
    applyStaticTranslations();
    renderComposerPickers(pickerState);
    renderTabs();
    updateMovementBombStatus();
    if (resourceStore && category !== "tryon") renderGrid();
  }

  function u32(view, offset) { return view.getUint32(offset, true); }
  function i32(view, offset) { return view.getInt32(offset, true); }

  function specialColor(red, green, blue) {
    const low = Math.min(red, blue), high = Math.max(red, blue);
    if (low < 220 || Math.abs(red - blue) > 36 || green >= low - 24 || high - green < 48) return null;
    if (green <= 4) return [0, 0, 0, 0];
    const channel = (value, target) => Math.max(0, Math.min(255, Math.floor((value * 255 - target * (255 - green) + Math.floor(green / 2)) / green)));
    return [channel(red, 255), channel(green, 0), channel(blue, 255), green];
  }

  function decodeRle24(bytes, start, end, pixelCount, special) {
    const pixels = new Uint8ClampedArray(pixelCount * 4);
    let position = start, pixel = 0;
    while (pixel < pixelCount && position < end) {
      const token = bytes[position++], count = token & 0x3f;
      if (!count) throw new Error(t("decoder.rle24_invalid"));
      if (token & 0x80) {
        pixel += count;
      } else if (token & 0x40) {
        if (position + 3 > end) throw new Error(t("decoder.rle24_repeat_cut"));
        const blue = bytes[position++], green = bytes[position++], red = bytes[position++];
        const rgba = (special && specialColor(red, green, blue)) || [red, green, blue, 255];
        for (let index = 0; index < count && pixel < pixelCount; index++, pixel++) pixels.set(rgba, pixel * 4);
      } else {
        if (position + count * 3 > end) throw new Error(t("decoder.rle24_value_cut"));
        for (let index = 0; index < count; index++, pixel++) {
          const blue = bytes[position++], green = bytes[position++], red = bytes[position++];
          pixels.set((special && specialColor(red, green, blue)) || [red, green, blue, 255], pixel * 4);
        }
      }
    }
    if (pixel < pixelCount) throw new Error(t("decoder.rle24_pixels_short"));
    return {pixels, position};
  }

  function decodeAlpha(bytes, start, end, pixels, pixelCount) {
    for (let index = 3; index < pixels.length; index += 4) pixels[index] = 0;
    let position = start, pixel = 0;
    while (pixel < pixelCount && position < end) {
      const token = bytes[position++], count = token & 0x3f;
      if (!count) throw new Error(t("decoder.alpha_invalid"));
      if (token & 0x80) {
        pixel += count;
      } else if (token & 0x40) {
        if (position >= end) throw new Error(t("decoder.alpha_repeat_cut"));
        const alpha = bytes[position++];
        for (let index = 0; index < count && pixel < pixelCount; index++, pixel++) pixels[pixel * 4 + 3] = alpha;
      } else {
        if (position + count > end) throw new Error(t("decoder.alpha_value_cut"));
        for (let index = 0; index < count; index++, pixel++) pixels[pixel * 4 + 3] = bytes[position++];
      }
    }
    if (pixel < pixelCount) throw new Error(t("decoder.alpha_pixels_short"));
  }

  function decodeRle565(bytes, start, end, pixelCount) {
    const pixels = new Uint8ClampedArray(pixelCount * 4);
    let position = start, pixel = 0;
    while (pixel < pixelCount && position < end) {
      const token = bytes[position++], count = token & 0x3f;
      if (!count) throw new Error(t("decoder.rle565_invalid"));
      if (token & 0x80) {
        pixel += count;
        continue;
      }
      const repeat = Boolean(token & 0x40);
      if (position + (repeat ? 2 : count * 2) > end) throw new Error(t("decoder.rle565_value_cut"));
      let repeated = 0;
      if (repeat) { repeated = bytes[position] | (bytes[position + 1] << 8); position += 2; }
      for (let index = 0; index < count; index++, pixel++) {
        const value = repeat ? repeated : bytes[position] | (bytes[position + 1] << 8);
        if (!repeat) position += 2;
        const target = pixel * 4;
        pixels[target] = Math.floor(((value >> 11) & 31) * 255 / 31);
        pixels[target + 1] = Math.floor(((value >> 5) & 63) * 255 / 63);
        pixels[target + 2] = Math.floor((value & 31) * 255 / 31);
        pixels[target + 3] = 255;
      }
    }
    if (pixel < pixelCount) throw new Error(t("decoder.rle565_pixels_short"));
    return pixels;
  }

  function decodeTexture(bytes, view, start, length, width, height) {
    if (width <= 0 || height <= 0 || width * height > 2500000 || length <= 0) return null;
    const end = start + length, marker = bytes[start] & 0xc1;
    let pixels;
    if (marker === 0xc0 || marker === 0xc1) {
      const hasAlpha = marker === 0xc1;
      if (hasAlpha) {
        const alphaStart = start + u32(view, start + 1);
        if (alphaStart < start + 5 || alphaStart >= end) throw new Error(t("decoder.alpha_stream_invalid"));
        pixels = decodeRle24(bytes, start + 5, alphaStart, width * height, false).pixels;
        decodeAlpha(bytes, alphaStart, end, pixels, width * height);
      } else {
        pixels = decodeRle24(bytes, start + 1, end, width * height, true).pixels;
      }
    } else {
      pixels = decodeRle565(bytes, start, end, width * height);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
    return canvas;
  }

  function decodeLegacy(bytes, view) {
    if (bytes.length < 24) throw new Error(t("decoder.legacy_short"));
    const frameCount = u32(view, 0), width = u32(view, 8), height = u32(view, 12);
    if (!frameCount || !width || !height || width * height > 2500000) throw new Error(t("decoder.legacy_size_invalid"));
    const start = 16 + frameCount * 28 + 4;
    const pixels = decodeRle565(bytes, start, bytes.length, width * height);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
    return {frames:[{canvas, record:{canvasWidth:width, canvasHeight:height, anchorX:0, anchorY:0}}], records:[], sourceFrameCount:1, maxWidth:width, maxHeight:height};
  }

  function decodeResource(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    if (bytes.length < 32 || u32(view, 4) !== 2) return decodeLegacy(bytes, view);
    const frameCount = u32(view, 0), textureCount = u32(view, 8);
    if (!frameCount || frameCount >= 4096 || !textureCount || textureCount >= 4096) throw new Error(t("decoder.header_invalid"));
    const sizesOffset = 16, recordsOffset = sizesOffset + textureCount * 8, chunksOffset = recordsOffset + frameCount * 48;
    if (chunksOffset + 4 > bytes.length) throw new Error(t("decoder.metadata_cut"));
    const dimensions = [];
    for (let index = 0; index < textureCount; index++) dimensions.push([u32(view, sizesOffset + index * 8 + 4), u32(view, sizesOffset + index * 8)]);
    const chunks = [];
    let position = chunksOffset;
    for (let index = 0; index < textureCount; index++) {
      if (position + 4 > bytes.length) throw new Error(t("decoder.texture_length_cut"));
      const length = u32(view, position); position += 4;
      if (position + length > bytes.length) throw new Error(t("decoder.texture_data_cut"));
      chunks.push([position, length]); position += length;
    }
    const textureCanvases = new Map(), frames = [], records = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const offset = recordsOffset + frameIndex * 48;
      const values = Array.from({length:12}, (_, index) => i32(view, offset + index * 4));
      const [originX, originY, _blend, textureIndex, rawLeft, rawTop, rawRight, rawBottom, rawCanvasWidth, rawCanvasHeight, anchorX, anchorY] = values;
      if (textureIndex < 0 || textureIndex >= textureCount) throw new Error(t("decoder.texture_index_invalid"));
      const [textureWidth, textureHeight] = dimensions[textureIndex];
      const left = Math.max(0, rawLeft), top = Math.max(0, rawTop), right = Math.min(textureWidth, rawRight), bottom = Math.min(textureHeight, rawBottom);
      const cropWidth = Math.max(0, right - left), cropHeight = Math.max(0, bottom - top);
      const canvasWidth = rawCanvasWidth > 0 && rawCanvasWidth <= 8192 ? rawCanvasWidth : cropWidth;
      const canvasHeight = rawCanvasHeight > 0 && rawCanvasHeight <= 8192 ? rawCanvasHeight : cropHeight;
      if (!canvasWidth || !canvasHeight || canvasWidth * canvasHeight > 2500000) throw new Error(t("decoder.frame_size_invalid"));
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth; canvas.height = canvasHeight;
      if (cropWidth && cropHeight && textureWidth && textureHeight) {
        if (!textureCanvases.has(textureIndex)) {
          const [chunkStart, chunkLength] = chunks[textureIndex];
          textureCanvases.set(textureIndex, decodeTexture(bytes, view, chunkStart, chunkLength, textureWidth, textureHeight));
        }
        const texture = textureCanvases.get(textureIndex);
        let drawX = anchorX - originX, drawY = anchorY - originY;
        if (!(drawX < canvasWidth && drawY < canvasHeight && drawX + cropWidth > 0 && drawY + cropHeight > 0)) { drawX = 0; drawY = 0; }
        canvas.getContext("2d").drawImage(texture, left, top, cropWidth, cropHeight, drawX, drawY, cropWidth, cropHeight);
      }
      const record = {originX, originY, textureIndex, left, top, right, bottom, canvasWidth, canvasHeight, anchorX, anchorY};
      records.push(record); frames.push({canvas, record});
    }
    return {frames, records, sourceFrameCount:frameCount, maxWidth:Math.max(...frames.map(frame => frame.canvas.width)), maxHeight:Math.max(...frames.map(frame => frame.canvas.height))};
  }

  class ResourceStore {
    constructor(files) { this.files = files; this.cache = new Map(); }
    async get(archive, resource) {
      const key = `${archive}:${resource}`;
      if (this.cache.has(key)) {
        const value = this.cache.get(key); this.cache.delete(key); this.cache.set(key, value); return value;
      }
      const record = RESOURCE_MANIFEST.entries[archive]?.[resource];
      const file = this.files.get(archive);
      if (!record || !file) throw new Error(t("resource.not_found", {key}));
      const promise = file.slice(record[0], record[0] + record[1]).arrayBuffer().then(decodeResource);
      this.cache.set(key, promise);
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
      try { return await promise; } catch (error) { this.cache.delete(key); throw error; }
    }
  }

  async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  async function validateFiles(files) {
    const byName = new Map([...files].map(file => [file.name.toLocaleLowerCase(), file]));
    const mapped = new Map();
    for (const [archive, expected] of Object.entries(RESOURCE_MANIFEST.files)) {
      const file = byName.get(expected.name.toLocaleLowerCase());
      if (!file) throw new Error(t("file.missing", {name:expected.name}));
      if (file.size !== expected.size) throw new Error(t("file.size_mismatch", {name:expected.name}));
      if (crypto?.subtle) {
        const sample = expected.sample_size;
        const [head, tail] = await Promise.all([
          sha256Hex(file.slice(0, Math.min(sample, file.size))),
          sha256Hex(file.slice(Math.max(0, file.size - sample), file.size)),
        ]);
        if (head !== expected.head_sha256 || tail !== expected.tail_sha256) throw new Error(t("file.version_mismatch", {name:expected.name}));
      }
      mapped.set(archive, file);
    }
    return mapped;
  }

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("poptag-viewer", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveDirectoryHandle(handle) {
    try {
      const db = await openHandleDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction("handles", "readwrite").objectStore("handles").put(handle, "poptag");
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
      });
      db.close();
    } catch (_error) { /* Persistence is optional. */ }
  }

  async function restoreDirectoryHandle() {
    try {
      const db = await openHandleDb();
      const handle = await new Promise((resolve, reject) => {
        const request = db.transaction("handles").objectStore("handles").get("poptag");
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      db.close();
      if (!handle || (await handle.queryPermission({mode:"read"})) !== "granted") return null;
      return handle;
    } catch (_error) { return null; }
  }

  async function filesFromDirectory(handle) {
    const files = [];
    for (const expected of Object.values(RESOURCE_MANIFEST.files)) files.push(await (await handle.getFileHandle(expected.name)).getFile());
    return files;
  }

  function gateStatus(message, type = "") {
    const button = $("#choose-folder");
    if (type === "error") {
      button.disabled = false;
      button.dataset.i18n = "folder.select";
      button.textContent = t("folder.select");
      alert(message);
      return;
    }
    button.disabled = type === "loading";
    button.dataset.i18n = button.disabled ? "folder.checking" : "folder.select";
    button.textContent = t(button.dataset.i18n);
  }

  async function connectFiles(files, handle = null) {
    gateStatus(t("folder.checking"), "loading");
    try {
      resourceStore = new ResourceStore(await validateFiles(files));
      resetMovementBombs();
      await applyMovementFieldTiles();
      if (handle) await saveDirectoryHandle(handle);
      gateStatus(t("folder.connected"), "ok");
      $("#resource-gate").classList.add("ready");
      renderTabs(); showCurrent(); rebuildComposer();
    } catch (error) {
      resourceStore = null; gateStatus(error.message, "error");
    }
  }

  const clampUnit = value => Math.max(0, Math.min(1, value));

  function rgbToHsl(red, green, blue) {
    const r = red / 255, g = green / 255, b = blue / 255;
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    const lightness = (maximum + minimum) / 2;
    if (maximum === minimum) return [0, 0, lightness];
    const difference = maximum - minimum;
    const saturation = lightness > 0.5 ? difference / (2 - maximum - minimum) : difference / (maximum + minimum);
    let hue;
    if (maximum === r) hue = (g - b) / difference + (g < b ? 6 : 0);
    else if (maximum === g) hue = (b - r) / difference + 2;
    else hue = (r - g) / difference + 4;
    return [hue * 60, saturation, lightness];
  }

  function hueChannel(lower, upper, hue) {
    let wrapped = hue;
    while (wrapped < 0) wrapped += 1;
    while (wrapped > 1) wrapped -= 1;
    if (wrapped < 1 / 6) return lower + (upper - lower) * 6 * wrapped;
    if (wrapped < 1 / 2) return upper;
    if (wrapped < 2 / 3) return lower + (upper - lower) * (2 / 3 - wrapped) * 6;
    return lower;
  }

  function hslToRgb(hue, saturation, lightness) {
    if (!saturation) {
      const channel = Math.trunc(lightness * 255);
      return [channel, channel, channel];
    }
    const upper = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const lower = 2 * lightness - upper, normalizedHue = hue / 360;
    return [
      Math.trunc(clampUnit(hueChannel(lower, upper, normalizedHue + 1 / 3)) * 255),
      Math.trunc(clampUnit(hueChannel(lower, upper, normalizedHue)) * 255),
      Math.trunc(clampUnit(hueChannel(lower, upper, normalizedHue - 1 / 3)) * 255),
    ];
  }

  function relativeAdjustment(value, percentage) {
    return clampUnit(value + (percentage >= 0 ? (1 - value) * percentage / 100 : value * percentage / 100));
  }

  function clientAdjustedColor(red, green, blue, colorKey) {
    const [hueDelta, lightnessDelta, saturationDelta] = characterColorAdjustments.get(colorKey) || [0, 0, 0];
    let [hue, saturation, lightness] = rgbToHsl(red, green, blue);
    hue = (hue + hueDelta) % 360;
    if (hue < 0) hue += 360;
    saturation = relativeAdjustment(saturation, saturationDelta);
    lightness = relativeAdjustment(lightness, lightnessDelta);
    return hslToRgb(hue, saturation, lightness);
  }

  function colorSwatch(colorKey) {
    return `rgb(${clientAdjustedColor(254, 0, 0, colorKey).join(", ")})`;
  }

  function toCanvas(source, colorKey) {
    if (!colorKey || colorKey === "red") return source;
    source._tints ||= new Map();
    if (source._tints.has(colorKey)) return source._tints.get(colorKey);
    const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext("2d", {willReadFrequently:true}); context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      if (!data[index + 3]) continue;
      [data[index], data[index + 1], data[index + 2]] = clientAdjustedColor(data[index], data[index + 1], data[index + 2], colorKey);
    }
    context.putImageData(image, 0, 0); source._tints.set(colorKey, canvas); return canvas;
  }

  function sequenceInfo(row, elapsed) {
    const sequence = row.frame_sequence?.length ? row.frame_sequence : Array.from({length:Math.max(1, row.frame_count || 1)}, (_, index) => index);
    const durations = row.frame_durations?.length === sequence.length ? row.frame_durations : Array(sequence.length).fill(DEFAULT_FRAME_DURATION);
    const period = durations.reduce((sum, value) => sum + Math.max(1, value), 0);
    let local = elapsed % period;
    for (let index = 0; index < durations.length; index++) {
      if (local < durations[index]) return {sequenceIndex:index, sourceIndex:sequence[index], period, durations};
      local -= durations[index];
    }
    return {sequenceIndex:0, sourceIndex:sequence[0], period, durations};
  }

  function movementVector(direction, moving = true) {
    if (!moving) return {x:0, y:0};
    return {
      x:(direction === "right" ? 1 : 0) - (direction === "left" ? 1 : 0),
      y:(direction === "down" ? 1 : 0) - (direction === "up" ? 1 : 0),
    };
  }

  function settleMovementFacing(state, now, delay = MOVEMENT_FACE_FORWARD_DELAY) {
    if (state.moving || now - state.lastDirectionInputAt < delay || state.direction === "down") return false;
    state.direction = "down";
    return true;
  }

  function movementCellForPosition(position, cellSize, width = MOVEMENT_WIDTH, height = MOVEMENT_HEIGHT, cellAnchor = [0, cellSize]) {
    const columns = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    return {
      column:Math.max(0, Math.min(columns - 1, Math.floor((position.x - cellAnchor[0] + cellSize / 2) / cellSize))),
      row:Math.max(0, Math.min(rows - 1, Math.floor((position.y - cellAnchor[1] + cellSize / 2) / cellSize))),
    };
  }

  function movementCellRect(cell, cellSize, cellAnchor = [0, cellSize]) {
    const centerX = cell.column * cellSize + cellAnchor[0];
    const centerY = cell.row * cellSize + cellAnchor[1];
    return {
      left:centerX - cellSize / 2,
      top:centerY - cellSize / 2,
      right:centerX + cellSize / 2,
      bottom:centerY + cellSize / 2,
    };
  }

  function movementPositionInsideCell(position, cell, cellSize, cellAnchor = [0, cellSize]) {
    const rect = movementCellRect(cell, cellSize, cellAnchor);
    return position.x >= rect.left && position.x < rect.right && position.y >= rect.top && position.y < rect.bottom;
  }

  function movementCellDrawPoint(cell, gridSize, renderScale = 1, drawOrigin = [0, gridSize[1] - 1]) {
    return [
      (cell.column * gridSize[0] + drawOrigin[0]) * renderScale,
      (cell.row * gridSize[1] + drawOrigin[1]) * renderScale,
    ];
  }

  function movementCellVisible(cell, cellSize, width = MOVEMENT_WIDTH, height = MOVEMENT_HEIGHT) {
    return cell.column >= 0 && cell.row >= 0 && cell.column * cellSize < width && cell.row * cellSize < height;
  }

  function movementBombExplosionTime(bomb, fuse = FIELD_BOMB_FUSE) {
    return Number.isFinite(bomb.explodeAt) ? bomb.explodeAt : bomb.placedAt + fuse;
  }

  function movementBombPhase(bomb, now, fuse = FIELD_BOMB_FUSE, fireDuration = FIELD_FIRE_DURATION) {
    const fireElapsed = now - movementBombExplosionTime(bomb, fuse);
    if (fireElapsed < 0) return {state:"bomb", elapsed:now - bomb.placedAt};
    if (fireElapsed < fireDuration) return {state:"fire", elapsed:fireElapsed};
    return {state:"expired", elapsed:fireElapsed};
  }

  function activeMovementBombCount(bombs, now, fuse = FIELD_BOMB_FUSE) {
    return bombs.filter(bomb => movementBombPhase(bomb, now, fuse, Number.POSITIVE_INFINITY).state === "bomb").length;
  }

  function movementFireCells(origin, power = FIELD_FIRE_POWER) {
    const cells = [{...origin, direction:"center", distance:0}];
    for (const [direction, column, row] of [["left",-1,0],["up",0,-1],["right",1,0],["down",0,1]]) {
      for (let distance = 1; distance <= power; distance++) cells.push({
        column:origin.column + column * distance,
        row:origin.row + row * distance,
        direction,
        distance,
      });
    }
    return cells;
  }

  function movementFireFrame(cell, visibleMaxDistance, elapsed, spec) {
    const directionalSequences = spec.fire_direction_sequences?.[cell.direction] || [];
    const remainingIndex = Math.max(0, Math.min(directionalSequences.length - 1, visibleMaxDistance - cell.distance));
    const sequence = cell.direction === "center" ? spec.fire_center_sequence : directionalSequences[remainingIndex];
    if (!sequence?.length) return null;
    const sequenceIndex = Math.floor(Math.max(0, elapsed) / (spec.fire_tick_ms || FIELD_FIRE_TICK));
    return sequenceIndex < sequence.length ? sequence[sequenceIndex] : null;
  }

  function movementChainOriginTime(bomb) {
    return Number.isFinite(bomb.chainOriginPlacedAt) ? bomb.chainOriginPlacedAt : bomb.placedAt;
  }

  function triggerMovementBombChains(bombs, now, power = FIELD_FIRE_POWER, fuse = FIELD_BOMB_FUSE, fireDuration = FIELD_FIRE_DURATION, chainWindow = FIELD_CHAIN_WINDOW) {
    let changed = true, triggered = 0;
    while (changed) {
      changed = false;
      for (const source of bombs) {
        const sourceTime = movementBombExplosionTime(source, fuse);
        const sourceEnd = sourceTime + fireDuration;
        if (sourceTime > now || now >= sourceEnd) continue;
        const originPlacedAt = movementChainOriginTime(source);
        const reached = new Set(movementFireCells(source, power).map(cell => `${cell.column},${cell.row}`));
        for (const target of bombs) {
          if (target === source || !reached.has(`${target.column},${target.row}`)) continue;
          // A chain keeps the placement time of the bomb that started it.
          // Bombs placed more than 2.5 seconds after that origin remain intact,
          // even if an intermediate chained flame reaches their tile.
          if (target.placedAt < originPlacedAt || target.placedAt - originPlacedAt > chainWindow) continue;
          const targetTime = movementBombExplosionTime(target, fuse);
          const hitTime = Math.max(sourceTime, target.placedAt);
          if (hitTime > now || hitTime >= sourceEnd || targetTime <= hitTime) continue;
          target.explodeAt = hitTime;
          target.chainOriginPlacedAt = originPlacedAt;
          triggered++;
          changed = true;
        }
      }
    }
    return triggered;
  }

  function resolveMovementBombPosition(bombs, currentPosition, nextPosition, now, cellSize, fuse = FIELD_BOMB_FUSE, cellAnchor = [0, cellSize]) {
    const resolved = {...nextPosition};
    const deltaX = nextPosition.x - currentPosition.x, deltaY = nextPosition.y - currentPosition.y;
    const edgeInset = .001;
    for (const bomb of bombs) {
      if (bomb.ownerCanPass === true || movementBombPhase(bomb, now, fuse, Number.POSITIVE_INFINITY).state !== "bomb") continue;
      if (movementPositionInsideCell(currentPosition, bomb, cellSize, cellAnchor)) continue;
      const rect = movementCellRect(bomb, cellSize, cellAnchor);
      const insideRows = nextPosition.y >= rect.top && nextPosition.y < rect.bottom;
      const insideColumns = nextPosition.x >= rect.left && nextPosition.x < rect.right;
      if (deltaX > 0 && insideRows && currentPosition.x < rect.left && nextPosition.x >= rect.left) resolved.x = Math.min(resolved.x, rect.left - edgeInset);
      else if (deltaX < 0 && insideRows && currentPosition.x >= rect.right && nextPosition.x < rect.right) resolved.x = Math.max(resolved.x, rect.right);
      else if (deltaY > 0 && insideColumns && currentPosition.y < rect.top && nextPosition.y >= rect.top) resolved.y = Math.min(resolved.y, rect.top - edgeInset);
      else if (deltaY < 0 && insideColumns && currentPosition.y >= rect.bottom && nextPosition.y < rect.bottom) resolved.y = Math.max(resolved.y, rect.bottom);
    }
    return resolved;
  }

  function movementBombBlocksPosition(bombs, currentPosition, nextPosition, now, cellSize, fuse = FIELD_BOMB_FUSE, cellAnchor = [0, cellSize]) {
    const resolved = resolveMovementBombPosition(bombs, currentPosition, nextPosition, now, cellSize, fuse, cellAnchor);
    return resolved.x !== nextPosition.x || resolved.y !== nextPosition.y;
  }

  function releaseMovementBombPassThrough(bombs, position, now, cellSize, fuse = FIELD_BOMB_FUSE, cellAnchor = [0, cellSize]) {
    for (const bomb of bombs) {
      if (bomb.ownerCanPass !== true || movementBombPhase(bomb, now, fuse, Number.POSITIVE_INFINITY).state !== "bomb") continue;
      if (!movementPositionInsideCell(position, bomb, cellSize, cellAnchor)) bomb.ownerCanPass = false;
    }
  }

  function movementCharacterScale() { return movementRenderScale; }

  function setMovementRenderScale(value) {
    const next = Number(value);
    if (!MOVEMENT_RENDER_SCALES.has(next)) return false;
    document.querySelectorAll("[data-movement-scale]").forEach(button => {
      const active = Number(button.dataset.movementScale) === next;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (next === movementRenderScale) return true;
    movementRenderScale = next;
    resetMovementBombs();
    updateMovementFieldTileScale(next);
    if (movementAnimation && category === "tryon") drawMovementAnimation(movementAnimation, performance.now());
    return true;
  }

  function updateMovementFieldTileScale(renderScale = movementCharacterScale()) {
    const wrapper = $(".movement-canvas-wrap");
    if (wrapper?.dataset.tilePatternReady !== "true") return;
    const movementWidth = $("#movement-canvas")?.getBoundingClientRect().width || 0;
    if (!movementWidth) return;
    const spec = RESOURCE_MANIFEST.defaults.field_tiles;
    const displayScale = renderScale * (movementWidth / MOVEMENT_WIDTH);
    const width = Math.max(2, spec.pattern_size[0] * displayScale);
    const height = Math.max(2, spec.pattern_size[1] * displayScale);
    const key = `${width.toFixed(4)}x${height.toFixed(4)}`;
    if (wrapper.dataset.tilePatternSize === key) return;
    wrapper.style.backgroundSize = `${width.toFixed(4)}px ${height.toFixed(4)}px`;
    wrapper.dataset.tilePatternSize = key;
  }

  function movementFireDuration() {
    return RESOURCE_MANIFEST.defaults.field_objects?.fire_duration_ms || FIELD_FIRE_DURATION;
  }

  function updateMovementBombStatus(now = performance.now()) {
    const active = activeMovementBombCount(movementBombs, now, FIELD_BOMB_FUSE);
    const status = $("#movement-bomb-status");
    if (status) status.textContent = t("bomb.status", {active, limit:FIELD_BOMB_LIMIT});
  }

  function pruneMovementBombs(now = performance.now()) {
    const duration = movementFireDuration();
    triggerMovementBombChains(movementBombs, now, FIELD_FIRE_POWER, FIELD_BOMB_FUSE, duration);
    movementBombs = movementBombs.filter(bomb => movementBombPhase(bomb, now, FIELD_BOMB_FUSE, duration).state !== "expired");
    updateMovementBombStatus(now);
  }

  function resetMovementBombs() {
    movementBombs = [];
    nextMovementBombId = 1;
    nextMovementBombState = 0;
    updateMovementBombStatus();
  }

  function placeMovementBomb(now = performance.now()) {
    if (!movementAnimation || category !== "tryon") return false;
    pruneMovementBombs(now);
    if (activeMovementBombCount(movementBombs, now, FIELD_BOMB_FUSE) >= FIELD_BOMB_LIMIT) return false;
    const spec = RESOURCE_MANIFEST.defaults.field_objects;
    const renderScale = movementCharacterScale();
    const cellSize = spec.grid_size[0] * renderScale;
    const cellAnchor = spec.grid_draw_origin.map(value => value * renderScale);
    // Character and bomb object positions use the same client grid anchor.
    // Choosing the nearest authored bomb anchor keeps placement centered on
    // the visual tile even though that anchor sits at its lower-left edge.
    const cell = movementCellForPosition(movementState, cellSize, MOVEMENT_WIDTH, MOVEMENT_HEIGHT, cellAnchor);
    if (movementBombs.some(bomb => bomb.column === cell.column && bomb.row === cell.row)) return false;
    const stateCount = Math.max(1, selectedBomb()?.connected_state_count || 1);
    const stateIndex = nextMovementBombState % stateCount;
    nextMovementBombState = (nextMovementBombState + 1) % stateCount;
    movementBombs.push({id:nextMovementBombId++, ...cell, stateIndex, placedAt:now, explodeAt:now + FIELD_BOMB_FUSE, ownerCanPass:true});
    updateMovementBombStatus(now);
    return true;
  }

  function clampMovementPosition(position, bounds, width = MOVEMENT_WIDTH, height = MOVEMENT_HEIGHT, renderScale = 1) {
    const minX = Math.max(0, -bounds.left * renderScale), maxX = Math.min(width, width - bounds.right * renderScale);
    const minY = Math.max(0, -bounds.top * renderScale), maxY = Math.min(height, height - bounds.bottom * renderScale);
    return {
      x:Math.max(minX, Math.min(maxX, position.x)),
      y:Math.max(minY, Math.min(maxY, position.y)),
    };
  }

  function portraitTimelineRow(character) {
    return {
      frame_count:character.portrait_frame_count,
      frame_sequence:character.portrait_frame_sequence,
      frame_durations:character.portrait_frame_durations,
    };
  }

  function portraitCostumeSourceIndex(row, portraitInfo) {
    return row.portrait_frame_offset + (portraitInfo.sourceIndex % row.portrait_frame_count);
  }

  function idDecoPortraitDrawPoint(gameDrawPoint) {
    return [
      gameDrawPoint[0] + ID_DECO_PORTRAIT_OFFSET[0],
      gameDrawPoint[1] + ID_DECO_PORTRAIT_OFFSET[1],
    ];
  }

  async function prepareParts(row) {
    return Promise.all((row.parts || row.resource_entries || []).map(async part => {
      const descriptor = typeof part === "string" ? {resource:part, adjust:false} : part;
      return {...descriptor, decoded:await resourceStore.get(row.archive, descriptor.resource)};
    }));
  }

  function visibleBombStates(row) {
    if (!row?.states?.length) return [];
    return row.connected ? row.states : row.states.slice(0, 1);
  }

  async function prepareMovementFieldObjects() {
    const spec = RESOURCE_MANIFEST.defaults.field_objects;
    const row = selectedBomb();
    const states = row ? visibleBombStates(row) : [{
      name:"Default",
      resource:spec.bomb_resource,
      frame_sequence:spec.bomb_frame_sequence || Array.from({length:spec.bomb_frame_count}, (_, index) => index),
      frame_durations:spec.bomb_frame_durations || Array(spec.bomb_frame_count).fill(FIELD_BOMB_FRAME_DURATION),
    }];
    const resources = new Map();
    await Promise.all([...new Set(states.map(state => state.resource))].map(async resource => {
      resources.set(resource, await resourceStore.get(row?.archive || spec.archive, resource));
    }));
    const [fire, shadow] = await Promise.all([
      resourceStore.get(spec.archive, spec.fire_resource),
      resourceStore.get(spec.archive, spec.shadow_resource),
    ]);
    return {
      spec,
      row,
      bombStates:states.map(state => ({...state, decoded:resources.get(state.resource)})),
      fire,
      shadow,
    };
  }

  function drawCenteredIn(context, decoded, sourceIndex, left, top, width, height) {
    const frame = decoded.frames[sourceIndex % decoded.frames.length];
    const drawLeft = left + Math.floor((width - decoded.maxWidth) / 2);
    const drawTop = top + Math.floor((height - decoded.maxHeight) / 2);
    context.drawImage(frame.canvas, drawLeft, drawTop);
    return {frame, left:drawLeft, top:drawTop};
  }

  function drawCentered(context, decoded, sourceIndex) { drawCenteredIn(context, decoded, sourceIndex, 0, 0, SLOT_SIZE, SLOT_SIZE); }

  function drawAnchoredCenteredIn(context, decoded, sourceIndex, left, top, width, height) {
    if (!decoded._anchorBounds) {
      const frameBounds = decoded.frames.map(frame => ({
        left:-frame.record.anchorX,
        top:-frame.record.anchorY,
        right:frame.canvas.width - frame.record.anchorX,
        bottom:frame.canvas.height - frame.record.anchorY,
      }));
      const bounds = {
        left:Math.min(...frameBounds.map(value => value.left)),
        top:Math.min(...frameBounds.map(value => value.top)),
        right:Math.max(...frameBounds.map(value => value.right)),
        bottom:Math.max(...frameBounds.map(value => value.bottom)),
      };
      decoded._anchorBounds = {...bounds, width:bounds.right - bounds.left, height:bounds.bottom - bounds.top};
    }
    const frame = decoded.frames[sourceIndex % decoded.frames.length], bounds = decoded._anchorBounds;
    const drawPoint = [
      left + Math.floor((width - bounds.width) / 2) - bounds.left,
      top + Math.floor((height - bounds.height) / 2) - bounds.top,
    ];
    context.drawImage(frame.canvas, drawPoint[0] - frame.record.anchorX, drawPoint[1] - frame.record.anchorY);
    return {frame, drawPoint};
  }

  function drawPositioned(context, part, sourceIndex, colorKey = "red", drawPoint = CHARACTER_DRAW_POINT) {
    const frame = part.decoded.frames[sourceIndex % part.decoded.frames.length];
    const record = frame.record;
    const source = part.adjust ? toCanvas(frame.canvas, colorKey) : frame.canvas;
    context.drawImage(source, drawPoint[0] - record.anchorX, drawPoint[1] - record.anchorY);
  }

  function drawScaledFieldFrame(context, decoded, sourceIndex, drawPoint, renderScale) {
    const point = drawPoint.map(Math.round);
    context.save();
    try {
      context.translate(point[0], point[1]);
      context.scale(renderScale, renderScale);
      context.translate(-point[0], -point[1]);
      drawPositioned(context, {decoded, adjust:false}, sourceIndex, "red", point);
    } finally {
      context.restore();
    }
  }

  function drawMovementShadow(context, decoded, sourceIndex, drawPoint, renderScale, opacity) {
    if (!decoded) return;
    context.save();
    try {
      context.globalAlpha *= opacity;
      drawScaledFieldFrame(context, decoded, sourceIndex, drawPoint, renderScale);
    } finally {
      context.restore();
    }
  }

  function drawMovementFieldObjects(context, prepared, now, renderScale) {
    pruneMovementBombs(now);
    const {spec, bombStates, fire, shadow} = prepared;
    const cellSize = spec.grid_size[0] * renderScale;
    const duration = spec.fire_duration_ms || FIELD_FIRE_DURATION;
    const signature = [];
    for (const placed of movementBombs) {
      const state = movementBombPhase(placed, now, FIELD_BOMB_FUSE, duration);
      if (state.state === "bomb") {
        const bombState = bombStates[placed.stateIndex % bombStates.length];
        const info = sequenceInfo(bombState, Math.max(0, state.elapsed));
        const drawPoint = movementCellDrawPoint(placed, spec.grid_size, renderScale, spec.grid_draw_origin);
        drawMovementShadow(context, shadow, spec.bomb_shadow_frame, drawPoint, renderScale, spec.shadow_opacity);
        drawScaledFieldFrame(context, bombState.decoded, info.sourceIndex, drawPoint, renderScale);
        signature.push(`b${placed.id}:${placed.stateIndex}:${info.sourceIndex}`);
        continue;
      }
      if (state.state !== "fire") continue;
      const cells = movementFireCells(placed, FIELD_FIRE_POWER);
      for (const direction of spec.fire_direction_order) {
        const arm = cells.filter(cell => cell.direction === direction && movementCellVisible(cell, cellSize));
        const visibleMaxDistance = Math.max(0, ...arm.map(cell => cell.distance));
        for (const cell of arm) {
          const sourceIndex = movementFireFrame(cell, visibleMaxDistance, state.elapsed, spec);
          if (sourceIndex != null) drawScaledFieldFrame(context, fire, sourceIndex, movementCellDrawPoint(cell, spec.grid_size, renderScale, spec.grid_draw_origin), renderScale);
        }
      }
      const centerIndex = movementFireFrame({direction:"center", distance:0}, 0, state.elapsed, spec);
      if (centerIndex != null) drawScaledFieldFrame(context, fire, centerIndex, movementCellDrawPoint(placed, spec.grid_size, renderScale, spec.grid_draw_origin), renderScale);
      signature.push(`f${placed.id}:${Math.floor(state.elapsed / (spec.fire_tick_ms || FIELD_FIRE_TICK))}`);
    }
    return signature.join(",");
  }

  function drawParts(context, parts, sourceIndex, colorKey, variants = null, drawPoint = CHARACTER_DRAW_POINT) {
    for (const part of parts) {
      if (variants && !variants.has(part.variant)) continue;
      drawPositioned(context, part, sourceIndex, colorKey, drawPoint);
    }
  }

  function costumeFrameInfo(row, characterInfo, elapsed) {
    if (row.sync_character && characterInfo) {
      // AvatarDeco's _1 display resource carries its own Blink frames 0..2.
      // Selecting the same source frame as the character preserves every
      // part's authored position, shape and visibility (including hats).
      const count = Math.max(1, row.idle_frame_count || 3);
      return {sourceIndex:characterInfo.sourceIndex % count, sequenceIndex:characterInfo.sequenceIndex};
    }
    if (row.pose_frame != null) return {sourceIndex:row.pose_frame, sequenceIndex:0};
    return sequenceInfo(row, elapsed);
  }

  function defaultHeadbandSpec(character) {
    return character ? RESOURCE_MANIFEST.defaults.headbands?.[character.code] || null : null;
  }

  function hidesDefaultHeadband(spec, row) {
    if (!spec || !row || row.source_system !== "AvatarDeco" || row.character_slot !== spec.equipment_slot) return false;
    // The client only checks target 6 (Head) and target 11 (Hair/Head
    // compound). Ordinary target-4 wigs deliberately leave the band visible.
    return row.raw_subtype === 6 || row.raw_subtype === 11;
  }

  function shouldShowDefaultHeadband(character, costumeRows) {
    const spec = defaultHeadbandSpec(character);
    return Boolean(spec && !hidesDefaultHeadband(spec, costumeRows?.head) && !hidesDefaultHeadband(spec, costumeRows?.hair));
  }

  async function prepareDefaultHeadband(character, costumeRows) {
    if (!shouldShowDefaultHeadband(character, costumeRows)) return null;
    const spec = defaultHeadbandSpec(character);
    return {spec, parts:await prepareParts(spec)};
  }

  async function prepareMovementDefaultHeadband(character, costumeRows) {
    if (!shouldShowDefaultHeadband(character, costumeRows)) return null;
    const spec = defaultHeadbandSpec(character);
    return {spec, parts:await prepareParts({archive:spec.archive, parts:spec.movement_parts})};
  }

  function drawDefaultHeadband(context, prepared, sourceIndex, colorKey, drawPoint = CHARACTER_DRAW_POINT, portrait = false) {
    if (!prepared) return;
    const frame = portrait
      ? prepared.spec.portrait_frame_offset + (sourceIndex % 2)
      : sourceIndex % prepared.spec.idle_frame_count;
    drawParts(context, prepared.parts, frame, colorKey, null, drawPoint);
  }

  function drawMovementDefaultHeadband(context, prepared, direction, sourceIndex, colorKey, drawPoint) {
    if (!prepared) return;
    const frame = prepared.spec.movement_frame_offsets[direction] + sourceIndex;
    drawParts(context, prepared.parts, frame, colorKey, null, drawPoint);
  }

  function preparedPartsBounds(partGroups) {
    const bounds = {left:0, top:0, right:0, bottom:0};
    for (const parts of partGroups) for (const part of parts) for (const frame of part.decoded.frames) {
      bounds.left = Math.min(bounds.left, -frame.record.anchorX);
      bounds.top = Math.min(bounds.top, -frame.record.anchorY);
      bounds.right = Math.max(bounds.right, frame.canvas.width - frame.record.anchorX);
      bounds.bottom = Math.max(bounds.bottom, frame.canvas.height - frame.record.anchorY);
    }
    return bounds;
  }

  async function prepareMovementCostume(row) {
    if (!row) return null;
    if (row.sync_character) {
      return {row, parts:await prepareParts({archive:row.archive, parts:row.movement_parts}), directions:{}};
    }
    const directions = {};
    await Promise.all(movementDirections.map(async direction => {
      const spec = row.movement?.[direction];
      if (spec) directions[direction] = {spec, parts:await prepareParts({archive:row.archive, parts:spec.parts})};
    }));
    return {row, parts:await prepareParts(row), directions};
  }

  function movementCostumeInfo(prepared, direction, characterInfo, elapsed) {
    const row = prepared.row;
    if (row.sync_character) {
      return {
        parts:prepared.parts,
        sourceIndex:row.movement_frame_offsets[direction] + characterInfo.sourceIndex,
        renderPlane:row.render_plane,
      };
    }
    const directional = prepared.directions[direction];
    if (directional) {
      const info = sequenceInfo(directional.spec, elapsed);
      return {parts:directional.parts, sourceIndex:info.sourceIndex, renderPlane:directional.spec.render_plane};
    }
    const info = costumeFrameInfo(row, null, elapsed);
    return {parts:prepared.parts, sourceIndex:info.sourceIndex, renderPlane:row.render_plane};
  }

  async function prepareDefaultBackground() {
    const spec = RESOURCE_MANIFEST.defaults.background;
    const decoded = await resourceStore.get(spec.archive, spec.resource);
    return {spec, decoded};
  }

  async function prepareDefaultFlag() {
    const spec = RESOURCE_MANIFEST.defaults.flag;
    const decoded = await resourceStore.get(spec.archive, spec.resource);
    const logical = document.createElement("canvas"); logical.width = spec.logical_size[0]; logical.height = spec.logical_size[1];
    logical.getContext("2d").drawImage(decoded.frames[spec.frame].canvas, spec.resource_origin[0], spec.resource_origin[1]);
    return {spec, logical};
  }

  async function applyMovementFieldTiles() {
    const spec = RESOURCE_MANIFEST.defaults.field_tiles;
    const [vertical, horizontal] = await Promise.all([
      resourceStore.get(spec.archive, spec.vertical_resource),
      resourceStore.get(spec.archive, spec.horizontal_resource),
    ]);
    const [tileWidth, tileHeight] = spec.tile_size;
    const pattern = document.createElement("canvas");
    pattern.width = spec.pattern_size[0];
    pattern.height = spec.pattern_size[1];
    const context = pattern.getContext("2d");
    context.imageSmoothingEnabled = false;
    const verticalTile = vertical.frames[spec.frame].canvas;
    const horizontalTile = horizontal.frames[spec.frame].canvas;
    context.drawImage(verticalTile, 0, 0, tileWidth, tileHeight);
    context.drawImage(horizontalTile, tileWidth, 0, tileWidth, tileHeight);
    context.drawImage(horizontalTile, 0, tileHeight, tileWidth, tileHeight);
    context.drawImage(verticalTile, tileWidth, tileHeight, tileWidth, tileHeight);
    const wrapper = $(".movement-canvas-wrap");
    wrapper.style.backgroundImage = `url("${pattern.toDataURL("image/png")}")`;
    wrapper.dataset.tileResources = `${spec.vertical_resource}|${spec.horizontal_resource}`;
    wrapper.dataset.tilePatternReady = "true";
    updateMovementFieldTileScale();
  }

  function drawDefaultBackground(context, prepared) {
    const {spec, decoded} = prepared, source = decoded.frames[spec.frame].canvas, crop = spec.crop;
    context.drawImage(source, crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1], spec.origin[0], spec.origin[1], crop[2] - crop[0], crop[3] - crop[1]);
  }

  function drawDefaultFlag(context, prepared) { context.drawImage(prepared.logical, prepared.spec.origin[0], prepared.spec.origin[1]); }

  async function createBaseRenderer(row) {
    const parts = await prepareParts(row), decoded = parts[0].decoded;
    return {
      draw(context, elapsed) {
        const info = sequenceInfo(row, elapsed); context.clearRect(0, 0, SLOT_SIZE, SLOT_SIZE); drawCentered(context, decoded, info.sourceIndex); return String(info.sourceIndex);
      },
    };
  }

  async function createBombRenderer(row) {
    const states = visibleBombStates(row);
    const resources = new Map();
    await Promise.all([...new Set(states.map(state => state.resource))].map(async resource => {
      resources.set(resource, await resourceStore.get(row.archive, resource));
    }));
    const periods = states.map(state => sequenceInfo(state, 0).period);
    const totalPeriod = Math.max(1, periods.reduce((sum, value) => sum + value, 0));
    return {
      timelineRows:states,
      draw(context, elapsed) {
        let local = Math.max(0, elapsed) % totalPeriod, stateIndex = 0;
        while (stateIndex < periods.length - 1 && local >= periods[stateIndex]) local -= periods[stateIndex++];
        const state = states[stateIndex], info = sequenceInfo(state, local);
        context.clearRect(0, 0, SLOT_SIZE, SLOT_SIZE);
        drawAnchoredCenteredIn(context, resources.get(state.resource), info.sourceIndex, 0, 0, SLOT_SIZE, SLOT_SIZE);
        return `${stateIndex}:${info.sourceIndex}`;
      },
    };
  }

  async function createCostumePreviewRenderer(row) {
    const selected = selectedCatalogCharacter();
    const selectedCanWear = selected && (row.character_slot == null || compatibleCostumeSlots(selected).has(row.character_slot));
    const character = selectedCanWear ? selected : characterBySlot.get(row.character_slot ?? DEFAULT_CHARACTER_SLOT) || CHARACTERS[0];
    const previewCostumes = {
      head:row.category === "head" ? row : null,
      hair:row.category === "hair" ? row : null,
    };
    const [characterParts, costumeParts, defaultHeadband] = await Promise.all([
      prepareParts(character), prepareParts(row), prepareDefaultHeadband(character, previewCostumes),
    ]);
    return {
      draw(context, elapsed) {
        const characterInfo = sequenceInfo(character, elapsed), costumeInfo = costumeFrameInfo(row, characterInfo, elapsed);
        context.clearRect(0, 0, SLOT_SIZE, SLOT_SIZE);
        const hairSelected = row.category === "hair", outfitSelected = row.category === "outfit";
        if (row.render_plane === "back") drawParts(context, costumeParts, costumeInfo.sourceIndex, "red");
        const baseVariants = new Set(outfitSelected ? ["A"] : ["A", "B"]);
        drawParts(context, characterParts, characterInfo.sourceIndex, "red", baseVariants);
        if (row.render_plane === "front" && row.category === "outfit") drawParts(context, costumeParts, costumeInfo.sourceIndex, "red");
        if (row.render_plane === "front" && row.category === "expression") drawParts(context, costumeParts, costumeInfo.sourceIndex, "red");
        if (!hairSelected) drawParts(context, characterParts, characterInfo.sourceIndex, "red", new Set(["C"]));
        if (row.render_plane === "front" && row.category === "hair") drawParts(context, costumeParts, costumeInfo.sourceIndex, "red");
        drawDefaultHeadband(context, defaultHeadband, characterInfo.sourceIndex, "red");
        if (row.render_plane === "front" && !["outfit", "expression", "hair"].includes(row.category)) drawParts(context, costumeParts, costumeInfo.sourceIndex, "red");
        return `${characterInfo.sourceIndex}:${costumeInfo.sourceIndex}`;
      },
    };
  }

  async function createPortraitRenderer() {
    const character = selectedCharacter();
    if (!character) return null;
    const costumeRows = Object.fromEntries(costumeCategories.map(key => [key, selectedCostume(key)]));
    const portraitRows = Object.fromEntries(costumeCategories.map(key => {
      const row = costumeRows[key];
      return [key, row?.portrait_supported ? row : null];
    }));
    const [characterParts, defaultHeadband, ...loaded] = await Promise.all([
      prepareParts({...character, parts:character.portrait_parts}),
      prepareDefaultHeadband(character, costumeRows),
      ...costumeCategories.map(key => portraitRows[key] ? prepareParts(portraitRows[key]) : Promise.resolve([])),
    ]);
    const costumeParts = Object.fromEntries(costumeCategories.map((key, index) => [key, loaded[index]]));
    const timelineRow = portraitTimelineRow(character), color = selectedColor();
    const drawCostume = (context, key, portraitInfo, drawPoint) => {
      const row = portraitRows[key];
      if (!row) return "-";
      const sourceIndex = portraitCostumeSourceIndex(row, portraitInfo);
      drawParts(context, costumeParts[key], sourceIndex, color, null, drawPoint);
      return String(sourceIndex);
    };
    return {
      timelineRows:[timelineRow],
      draw(context, elapsed, drawPoint) {
        const portraitInfo = sequenceInfo(timelineRow, elapsed), signature = [];
        for (const key of costumeCategories) {
          if (portraitRows[key]?.render_plane === "back") signature.push(`${key}:${drawCostume(context, key, portraitInfo, drawPoint)}`);
        }
        const baseVariants = new Set(portraitRows.outfit ? ["A"] : ["A", "B"]);
        drawParts(context, characterParts, portraitInfo.sourceIndex, color, baseVariants, drawPoint);
        if (portraitRows.outfit && portraitRows.outfit.render_plane !== "back") signature.push(`outfit:${drawCostume(context, "outfit", portraitInfo, drawPoint)}`);
        if (portraitRows.expression && portraitRows.expression.render_plane !== "back") signature.push(`expression:${drawCostume(context, "expression", portraitInfo, drawPoint)}`);
        if (!portraitRows.hair) drawParts(context, characterParts, portraitInfo.sourceIndex, color, new Set(["C"]), drawPoint);
        else if (portraitRows.hair.render_plane !== "back") signature.push(`hair:${drawCostume(context, "hair", portraitInfo, drawPoint)}`);
        if (defaultHeadband) {
          drawDefaultHeadband(context, defaultHeadband, portraitInfo.sourceIndex, color, drawPoint, true);
          signature.push(`default-headband:${defaultHeadband.spec.portrait_frame_offset + portraitInfo.sourceIndex}`);
        }
        for (const key of ["head", "mask", "accessory", "wing", "special"]) {
          if (portraitRows[key] && portraitRows[key].render_plane !== "back") signature.push(`${key}:${drawCostume(context, key, portraitInfo, drawPoint)}`);
        }
        signature.push(`portrait:${portraitInfo.sourceIndex}`);
        return signature.join("|");
      },
    };
  }

  function idDecoTimelineRows(row) {
    return [
      {frame_count:row.lobby_frame_count, frame_durations:row.lobby_frame_durations},
      {frame_count:row.game_frame_count, frame_durations:row.game_frame_durations},
    ];
  }

  async function createIdDecoRenderer(row, portraitRenderer = null) {
    const [lobby, game] = await Promise.all([
      resourceStore.get(row.archive, row.lobby_resource),
      resourceStore.get(row.archive, row.game_resource),
    ]);
    const [lobbyTimeline, gameTimeline] = idDecoTimelineRows(row);
    return {
      timelineRows:[lobbyTimeline, gameTimeline, ...(portraitRenderer?.timelineRows || [])],
      draw(context, elapsed) {
        const lobbyInfo = sequenceInfo(lobbyTimeline, elapsed), gameInfo = sequenceInfo(gameTimeline, elapsed);
        context.clearRect(0, 0, ID_DECO_WIDTH, ID_DECO_HEIGHT);
        drawAnchoredCenteredIn(context, lobby, lobbyInfo.sourceIndex, 0, 0, ID_DECO_CELL_WIDTH, ID_DECO_HEIGHT);
        const gamePlacement = drawAnchoredCenteredIn(context, game, gameInfo.sourceIndex, ID_DECO_CELL_WIDTH + ID_DECO_GAP, 0, ID_DECO_CELL_WIDTH, ID_DECO_HEIGHT);
        const portraitSignature = portraitRenderer?.draw(context, elapsed, idDecoPortraitDrawPoint(gamePlacement.drawPoint)) || "";
        return `${lobbyInfo.sourceIndex}:${gameInfo.sourceIndex}:${portraitSignature}`;
      },
    };
  }

  async function createRowRenderer(row) {
    if (row.category === ID_DECO_CATEGORY) return createIdDecoRenderer(row);
    if (row.category === BOMB_CATEGORY) return createBombRenderer(row);
    return baseCategories.includes(row.category) ? createBaseRenderer(row) : createCostumePreviewRenderer(row);
  }

  function animationLoop(now) {
    if (now - lastAnimationTick >= 45) {
      lastAnimationTick = now;
      for (const item of previewAnimations.values()) drawAnimationItem(item, now);
      if (modalAnimation) drawAnimationItem(modalAnimation, now);
      if (composerAnimation) drawAnimationItem(composerAnimation, now);
      if (idDecoAnimation) drawAnimationItem(idDecoAnimation, now);
    }
    if (movementAnimation && category === "tryon") drawMovementAnimation(movementAnimation, now);
    requestAnimationFrame(animationLoop);
  }

  function drawAnimationItem(item, now) {
    try {
      const elapsed = now - item.started;
      const signature = item.renderer.draw(item.context, elapsed);
      item.signature = signature;
    } catch (error) {
      const {width, height} = item.context.canvas;
      item.context.clearRect(0, 0, width, height);
      item.context.fillStyle = "#842f38"; item.context.font = "10px sans-serif"; item.context.fillText(t("render.error"), 8, 18);
      console.error(error);
    }
  }

  function drawMovementAnimation(item, now) {
    try {
      const delta = Math.min(50, Math.max(0, now - item.lastTick));
      item.lastTick = now;
      const renderScale = movementCharacterScale();
      updateMovementFieldTileScale(renderScale);
      pruneMovementBombs(now);
      settleMovementFacing(movementState, now);
      const vector = movementVector(movementState.direction, movementState.moving);
      const candidate = movementState.moving ? {
        x:movementState.x + vector.x * MOVEMENT_SPEED * delta / 1000,
        y:movementState.y + vector.y * MOVEMENT_SPEED * delta / 1000,
      } : movementState;
      const clamped = clampMovementPosition(candidate, item.renderer.bounds, MOVEMENT_WIDTH, MOVEMENT_HEIGHT, renderScale);
      const fieldSpec = RESOURCE_MANIFEST.defaults.field_objects;
      const cellSize = fieldSpec.grid_size[0] * renderScale;
      const cellAnchor = fieldSpec.grid_draw_origin.map(value => value * renderScale);
      const resolved = resolveMovementBombPosition(movementBombs, movementState, clamped, now, cellSize, FIELD_BOMB_FUSE, cellAnchor);
      movementState.x = resolved.x; movementState.y = resolved.y;
      releaseMovementBombPassThrough(movementBombs, movementState, now, cellSize, FIELD_BOMB_FUSE, cellAnchor);
      item.signature = item.renderer.draw(item.context, now - item.started, {
        ...movementState,
        now,
        renderScale,
        walkElapsed:movementState.moving ? now - movementState.walkStarted : 0,
      });
    } catch (error) {
      item.context.clearRect(0, 0, MOVEMENT_WIDTH, MOVEMENT_HEIGHT);
      console.error(error);
    }
  }

  function clearGridAnimations() {
    previewGeneration++;
    previewAnimations.clear();
    if (previewObserver) previewObserver.disconnect();
  }

  function observePreviews() {
    const generation = previewGeneration;
    previewObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const canvas = entry.target;
        canvas._visible = entry.isIntersecting;
        if (!entry.isIntersecting) { previewAnimations.delete(canvas); canvas._renderer = null; continue; }
        if (canvas._loading || canvas._renderer) continue;
        canvas._loading = true;
        createRowRenderer(canvas._row).then(renderer => {
          if (generation !== previewGeneration || !canvas.isConnected || !canvas._visible) return;
          canvas._renderer = renderer;
          const item = {renderer, context:canvas.getContext("2d"), started:performance.now(), signature:""};
          previewAnimations.set(canvas, item); drawAnimationItem(item, performance.now());
        }).catch(error => {
          const context = canvas.getContext("2d"); context.fillStyle = "#842f38"; context.fillRect(0, 0, canvas.width, canvas.height); console.error(error);
        }).finally(() => { canvas._loading = false; });
      }
    }, {rootMargin:"300px 0px"});
    document.querySelectorAll("canvas.thumb").forEach(canvas => previewObserver.observe(canvas));
  }

  function filteredRows() {
    const query = search.value.trim().toLocaleLowerCase();
    const selected = selectedCatalogCharacter(), compatibleSlots = compatibleCostumeSlots(selected);
    const rows = rowsForCategory(category)
      .filter(row => !selected || row.character_slot == null || compatibleSlots.has(row.character_slot))
      .filter(row => !query || [row.code, rowLabel(row), rowResource(row), ...(row.item_ids || [])].join(" ").toLocaleLowerCase().includes(query));
    if (sort.value === "frames") rows.sort((left, right) => right.frame_count - left.frame_count || left.code - right.code);
    else if (sort.value === "name") rows.sort((left, right) => rowLabel(left).localeCompare(rowLabel(right), "ko"));
    else rows.sort((left, right) => left.code - right.code || rowLabel(left).localeCompare(rowLabel(right), "ko"));
    return rows;
  }

  function renderTabs() {
    const buttons = keys => keys.map(key => `<button class="tab ${key === category ? "active" : ""}" data-category="${key}">${escapeHtml(categoryLabel(key))} <span>${formatNumber(rowsForCategory(key).length)}</span></button>`).join("");
    $("#base-tabs").innerHTML = buttons(baseCategories);
    $("#costume-tabs").innerHTML = buttons(costumeCategories);
    $("#id-deco-tabs").innerHTML = buttons(extraCategories);
    $("#tryon-tab").classList.toggle("active", category === "tryon");
    $("#tryon-tab").setAttribute("aria-pressed", String(category === "tryon"));
    characterFilter.hidden = !costumeCategories.includes(category);
  }

  function rowFrameBadge(row) {
    if (row.category === ID_DECO_CATEGORY) return t("badge.id_deco", {lobby:row.lobby_frame_count, game:row.game_frame_count});
    if (row.category === BOMB_CATEGORY && row.connected) return t("badge.connected", {count:row.connected_state_count});
    return t("badge.frames", {prefix:row.frame_count > 1 ? "GIF · " : "", count:row.frame_count});
  }

  function rowPreview(row) {
    const label = t("catalog.preview_aria", {category:categoryLabel(row.category), code:String(row.code).padStart(4, "0")});
    if (row.category === ID_DECO_CATEGORY) {
      return `<div class="preview-shell id-deco-preview"><div class="id-deco-palette"><div class="palette-labels"><span>${escapeHtml(t("palette.lobby"))}</span><span>${escapeHtml(t("palette.in_game"))}</span></div><canvas class="thumb id-deco-canvas" width="${ID_DECO_WIDTH}" height="${ID_DECO_HEIGHT}" aria-label="${escapeHtml(label)}"></canvas></div></div>`;
    }
    return `<div class="preview-shell"><canvas class="thumb" width="${SLOT_SIZE}" height="${SLOT_SIZE}" aria-label="${escapeHtml(label)}"></canvas></div>`;
  }

  function renderGrid() {
    clearGridAnimations();
    const rows = filteredRows(), selected = selectedCatalogCharacter(), compatibleSlots = compatibleCostumeSlots(selected);
    const total = rowsForCategory(category)
      .filter(row => !selected || row.character_slot == null || compatibleSlots.has(row.character_slot)).length;
    $("#count").textContent = t("catalog.count", {shown:formatNumber(rows.length), total:formatNumber(total)});
    grid.innerHTML = rows.length ? rows.map(row => `<button class="card ${row.item_table_linked ? "" : "unlinked"}" data-key="${escapeHtml(row.key)}">${rowPreview(row)}<div class="body"><div class="row"><span class="code">${escapeHtml(rowCode(row))}</span><span class="badge">${escapeHtml(rowFrameBadge(row))}</span></div><div class="name">${escapeHtml(rowLabel(row))}</div><div class="resource">${escapeHtml(rowResource(row))}</div></div></button>`).join("") : `<div class="empty">${escapeHtml(t("catalog.empty"))}</div>`;
    for (const [index, canvas] of [...document.querySelectorAll("canvas.thumb")].entries()) canvas._row = rows[index];
    observePreviews();
  }

  function lookupRow(key) { return CATALOG.find(row => row.key === key) || costumeByKey.get(key) || idDecoByKey.get(key) || bombByKey.get(key); }

  async function openRow(row) {
    if (!row) return;
    const isIdDeco = row.category === ID_DECO_CATEGORY;
    const isBomb = row.category === BOMB_CATEGORY;
    $("#vcode").textContent = isIdDeco
      ? t("summary.id_deco", {code:rowCode(row), lobby:row.lobby_frame_count, game:row.game_frame_count})
      : isBomb && row.connected
        ? t("summary.connected", {code:rowCode(row), count:row.connected_state_count})
        : t("summary.frames", {code:rowCode(row), count:row.frame_count});
    $("#vname").textContent = rowLabel(row);
    const tryButton = $("#try-item"); tryButton.dataset.key = row.key;
    const details = isIdDeco ? [
      [t("detail.type"), categoryLabel(row.category)], [t("detail.lobby_resource"), row.lobby_resource],
      [t("detail.in_game_resource"), row.game_resource], [t("detail.lobby_size"), row.lobby_frame_dimensions.join(", ")],
      [t("detail.in_game_size"), row.game_frame_dimensions.join(", ")], [t("detail.item_id"), row.item_ids?.length ? row.item_ids.join(", ") : t("value.none")],
    ] : isBomb ? [
      [t("detail.type"), categoryLabel(row.category)], [t("detail.resource"), rowResource(row)],
      [t("detail.size"), row.frame_dimensions.join(", ")], [t("detail.form"), row.connected ? t("bomb.connected_cycle", {count:row.connected_state_count}) : t("bomb.normal")],
      [t("detail.item_id"), row.item_ids?.length ? row.item_ids.join(", ") : t("value.none")],
    ] : [
      [t("detail.type"), categoryLabel(row.category)], [t("detail.resource"), rowResource(row)],
      [t("detail.size"), row.frame_dimensions.join(", ")], [t("detail.display_format"), row.frame_count > 1 ? t("display.animated_gif") : t("display.static_image")],
      [t("detail.item_id"), row.item_ids?.length ? row.item_ids.join(", ") : t("value.none")],
    ];
    $("#details").innerHTML = details.map(([key, value]) => `<div class="detail"><small>${key}</small><div>${escapeHtml(value)}</div></div>`).join("");
    const canvas = $("#modal-canvas"), shell = $("#modal-shell"), paletteLabels = $("#modal-palette-labels");
    canvas.width = isIdDeco ? ID_DECO_WIDTH : SLOT_SIZE;
    canvas.height = isIdDeco ? ID_DECO_HEIGHT : SLOT_SIZE;
    shell.classList.toggle("id-deco-mode", isIdDeco);
    paletteLabels.hidden = !isIdDeco;
    viewer.showModal();
    try {
      const renderer = await createRowRenderer(row);
      modalAnimation = {renderer, context:canvas.getContext("2d"), started:performance.now(), signature:""};
      drawAnimationItem(modalAnimation, performance.now());
    } catch (error) { alert(t("preview.failed", {message:error.message})); }
  }

  function selectedBaseRow(key) {
    const value = $(`#pick-${key}`)?.value;
    return value ? (catalogByCategory.get(key) || []).find(row => String(row.code) === value) : null;
  }

  function selectedIdDecoration() {
    const value = $("#pick-id-deco")?.value;
    return value ? idDecoByCode.get(Number(value)) || null : null;
  }

  function selectedBomb() {
    const value = $("#pick-bomb")?.value;
    return value ? bombByCode.get(Number(value)) || null : null;
  }

  function selectedCharacter() {
    const value = $("#pick-character")?.value;
    return value === "" || value == null ? null : characterBySlot.get(Number(value));
  }

  function selectedCostume(key) { return costumeByKey.get($(`#pick-costume-${key}`)?.value) || null; }
  function selectedColor() { return $("#pick-character-color")?.value || "red"; }
  function selectedCatalogCharacter() {
    return characterFilter.hidden || !characterFilter.value ? null : characterBySlot.get(Number(characterFilter.value)) || null;
  }
  function compatibleCostumeSlots(character) {
    if (!character) return new Set();
    const slots = new Set([character.code]), inherited = costumeInheritance.get(character.code);
    if (inherited !== undefined) slots.add(inherited);
    return slots;
  }

  async function createCompositionRenderer() {
    const baseRows = Object.fromEntries(baseCategories.map(key => [key, selectedBaseRow(key)]));
    const character = selectedCharacter();
    const costumeRows = Object.fromEntries(costumeCategories.map(key => [key, selectedCostume(key)]));
    const [defaultBackground, defaultFlag, characterParts, defaultHeadband, ...loaded] = await Promise.all([
      prepareDefaultBackground(), prepareDefaultFlag(), character ? prepareParts(character) : Promise.resolve([]),
      prepareDefaultHeadband(character, costumeRows),
      ...baseCategories.map(key => baseRows[key] ? prepareParts(baseRows[key]) : Promise.resolve([])),
      ...costumeCategories.map(key => costumeRows[key] ? prepareParts(costumeRows[key]) : Promise.resolve([])),
    ]);
    const baseParts = Object.fromEntries(baseCategories.map((key, index) => [key, loaded[index]]));
    const costumeParts = Object.fromEntries(costumeCategories.map((key, index) => [key, loaded[baseCategories.length + index]]));
    const color = selectedColor();
    const drawCostume = (context, key, elapsed, characterSource) => {
      const row = costumeRows[key]; if (!row) return "-";
      const characterInfo = characterSource == null ? null : {sourceIndex:characterSource, sequenceIndex:0};
      const info = costumeFrameInfo(row, characterInfo, elapsed);
      drawParts(context, costumeParts[key], info.sourceIndex, color); return String(info.sourceIndex);
    };
    return {
      timelineRows: [
        ...baseCategories.map(key => baseRows[key]).filter(Boolean),
        ...(character ? [character] : []),
        ...costumeCategories.map(key => costumeRows[key]).filter(row => row && !row.sync_character),
      ],
      draw(context, elapsed) {
        context.clearRect(0, 0, SLOT_SIZE, SLOT_SIZE);
        const signature = [];
        if (baseRows.background) { const info = sequenceInfo(baseRows.background, elapsed); drawCentered(context, baseParts.background[0].decoded, info.sourceIndex); signature.push(`b${info.sourceIndex}`); }
        else { drawDefaultBackground(context, defaultBackground); signature.push("bd"); }
        if (baseRows.flag) { const info = sequenceInfo(baseRows.flag, elapsed); drawCentered(context, baseParts.flag[0].decoded, info.sourceIndex); signature.push(`f${info.sourceIndex}`); }
        else { drawDefaultFlag(context, defaultFlag); signature.push("fd"); }

        const charInfo = character ? sequenceInfo(character, elapsed) : {sourceIndex:0};
        for (const key of costumeCategories) if (costumeRows[key]?.render_plane === "back") signature.push(`${key}:${drawCostume(context, key, elapsed, charInfo.sourceIndex)}`);
        if (character) {
          const baseVariants = new Set(costumeRows.outfit ? ["A"] : ["A", "B"]);
          drawParts(context, characterParts, charInfo.sourceIndex, color, baseVariants);
          if (costumeRows.outfit?.render_plane !== "back") signature.push(`outfit:${drawCostume(context, "outfit", elapsed, charInfo.sourceIndex)}`);
          if (costumeRows.expression?.render_plane !== "back") signature.push(`expression:${drawCostume(context, "expression", elapsed, charInfo.sourceIndex)}`);
          if (!costumeRows.hair) drawParts(context, characterParts, charInfo.sourceIndex, color, new Set(["C"]));
          else if (costumeRows.hair.render_plane !== "back") signature.push(`hair:${drawCostume(context, "hair", elapsed, charInfo.sourceIndex)}`);
          if (defaultHeadband) { drawDefaultHeadband(context, defaultHeadband, charInfo.sourceIndex, color); signature.push(`default-headband:${charInfo.sourceIndex % defaultHeadband.spec.idle_frame_count}`); }
          for (const key of ["head", "mask", "accessory", "wing", "special"]) if (costumeRows[key]?.render_plane !== "back") signature.push(`${key}:${drawCostume(context, key, elapsed, charInfo.sourceIndex)}`);
          signature.push(`c${charInfo.sourceIndex}`);
        } else {
          for (const key of costumeCategories) if (costumeRows[key]?.render_plane !== "back") signature.push(`${key}:${drawCostume(context, key, elapsed, null)}`);
        }
        for (const key of ["prop", "effect"]) if (baseRows[key]) { const info = sequenceInfo(baseRows[key], elapsed); drawCentered(context, baseParts[key][0].decoded, info.sourceIndex); signature.push(`${key}:${info.sourceIndex}`); }
        return signature.join("|");
      },
    };
  }

  async function createMovementRenderer() {
    const character = selectedCharacter();
    if (!character) return null;
    const costumeRows = Object.fromEntries(costumeCategories.map(key => [key, selectedCostume(key)]));
    const [characterEntries, defaultHeadband, fieldObjects, ...loadedCostumes] = await Promise.all([
      Promise.all(movementDirections.map(async direction => [
        direction,
        await prepareParts({archive:character.archive, parts:character.movement[direction].parts}),
      ])),
      prepareMovementDefaultHeadband(character, costumeRows),
      prepareMovementFieldObjects(),
      ...costumeCategories.map(key => prepareMovementCostume(costumeRows[key])),
    ]);
    const characterParts = Object.fromEntries(characterEntries);
    const preparedCostumes = Object.fromEntries(costumeCategories.map((key, index) => [key, loadedCostumes[index]]));
    const color = selectedColor();
    const bounds = preparedPartsBounds(Object.values(characterParts));

    return {
      bounds,
      draw(context, elapsed, state) {
        context.clearRect(0, 0, MOVEMENT_WIDTH, MOVEMENT_HEIGHT);
        context.imageSmoothingEnabled = false;
        const direction = state.direction;
        const action = character.movement[direction];
        const characterInfo = state.moving ? sequenceInfo(action, state.walkElapsed) : {sourceIndex:0, sequenceIndex:0};
        const drawPoint = [Math.round(state.x), Math.round(state.y)];
        const renderScale = state.renderScale || 1;
        const fieldSignature = drawMovementFieldObjects(context, fieldObjects, state.now ?? performance.now(), renderScale);
        const costumeInfo = Object.fromEntries(costumeCategories.map(key => [
          key,
          preparedCostumes[key] ? movementCostumeInfo(preparedCostumes[key], direction, characterInfo, elapsed) : null,
        ]));
        const drawCostume = key => {
          const info = costumeInfo[key];
          if (info) drawParts(context, info.parts, info.sourceIndex, color, null, drawPoint);
        };

        context.save();
        try {
          context.translate(drawPoint[0], drawPoint[1]);
          context.scale(renderScale, renderScale);
          context.translate(-drawPoint[0], -drawPoint[1]);
          drawMovementShadow(context, fieldObjects.shadow, fieldObjects.spec.character_shadow_frame, drawPoint, 1, fieldObjects.spec.shadow_opacity);
          for (const key of costumeCategories) if (costumeInfo[key]?.renderPlane === "back") drawCostume(key);
          const baseVariants = new Set(costumeRows.outfit ? ["A"] : ["A", "B"]);
          drawParts(context, characterParts[direction], characterInfo.sourceIndex, color, baseVariants, drawPoint);
          if (costumeInfo.outfit?.renderPlane !== "back") drawCostume("outfit");
          if (costumeInfo.expression?.renderPlane !== "back") drawCostume("expression");
          if (!costumeRows.hair) drawParts(context, characterParts[direction], characterInfo.sourceIndex, color, new Set(["C"]), drawPoint);
          else if (costumeInfo.hair?.renderPlane !== "back") drawCostume("hair");
          drawMovementDefaultHeadband(context, defaultHeadband, direction, characterInfo.sourceIndex, color, drawPoint);
          for (const key of ["head", "mask", "accessory", "wing", "special"]) if (costumeInfo[key]?.renderPlane !== "back") drawCostume(key);
        } finally {
          context.restore();
        }
        return `${direction}:${characterInfo.sourceIndex}:${drawPoint.join(",")}:${renderScale.toFixed(3)}:${fieldSignature}`;
      },
    };
  }

  let composerBuild = 0;
  async function rebuildComposer() {
    if (!resourceStore) return;
    const generation = ++composerBuild;
    try {
      const idDecoration = selectedIdDecoration();
      const [renderer, portraitRenderer, movementRenderer] = await Promise.all([
        createCompositionRenderer(),
        idDecoration ? createPortraitRenderer() : Promise.resolve(null),
        createMovementRenderer(),
      ]);
      const idRenderer = idDecoration ? await createIdDecoRenderer(idDecoration, portraitRenderer) : null;
      if (generation !== composerBuild) return;
      composerAnimation = {renderer, context:$("#stage-canvas").getContext("2d"), started:performance.now(), signature:""};
      drawAnimationItem(composerAnimation, performance.now());
      const idContext = $("#id-deco-canvas").getContext("2d");
      idDecoAnimation = idRenderer ? {renderer:idRenderer, context:idContext, started:performance.now(), signature:""} : null;
      if (idDecoAnimation) drawAnimationItem(idDecoAnimation, performance.now());
      else idContext.clearRect(0, 0, ID_DECO_WIDTH, ID_DECO_HEIGHT);
      const movementContext = $("#movement-canvas").getContext("2d"), movementNow = performance.now();
      movementAnimation = movementRenderer ? {renderer:movementRenderer, context:movementContext, started:movementNow, lastTick:movementNow, signature:""} : null;
      $("#movement-empty").hidden = Boolean(movementAnimation);
      updateMovementFieldTileScale(movementCharacterScale());
      if (movementAnimation) drawMovementAnimation(movementAnimation, movementNow);
      else { movementContext.clearRect(0, 0, MOVEMENT_WIDTH, MOVEMENT_HEIGHT); resetMovementBombs(); }
    } catch (error) { console.error(error); }
  }

  function refreshCostumePickers(previousValues = null) {
    const character = selectedCharacter();
    const compatibleSlots = compatibleCostumeSlots(character);
    for (const key of costumeCategories) {
      const select = $(`#pick-costume-${key}`);
      const previous = previousValues && Object.hasOwn(previousValues, key) ? previousValues[key] : select.value;
      const compatible = (costumesByCategory.get(key) || []).filter(row => row.character_slot == null || compatibleSlots.has(row.character_slot));
      const slotRank = row => row.character_slot == null ? 0 : row.character_slot === character?.code ? 1 : 2;
      compatible.sort((left, right) => slotRank(left) - slotRank(right) || left.code - right.code || rowLabel(left).localeCompare(rowLabel(right), "ko"));
      select.innerHTML = `<option value="">${escapeHtml(t("picker.none"))}</option>${compatible.map(row => `<option value="${escapeHtml(row.key)}">${row.character_slot == null ? escapeHtml(t("picker.common")) : escapeHtml(t("picker.exclusive", {character:characterName(row.character_slot)}))} · ${String(row.code).padStart(4, "0")} · ${escapeHtml(rowLabel(row))}</option>`).join("")}`;
      select.value = compatible.some(row => row.key === previous) ? previous : "";
      select.disabled = !compatible.length;
    }
  }

  function categoryListButton(key, labelKey) {
    const title = t("category.list", {category:t(labelKey)});
    return `<button class="category-list-button" type="button" data-open-category="${key}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg></button>`;
  }

  function composerPickerState() {
    const value = selector => $(selector)?.value ?? "";
    return {
      catalogCharacter:characterFilter.value,
      character:value("#pick-character"),
      color:value("#pick-character-color") || "red",
      costumes:Object.fromEntries(costumeCategories.map(key => [key, value(`#pick-costume-${key}`)])),
      bases:Object.fromEntries(baseCategories.map(key => [key, value(`#pick-${key}`)])),
      bomb:value("#pick-bomb"),
      idDeco:value("#pick-id-deco"),
    };
  }

  function renderComposerPickers(state = {}) {
    const catalogCharacter = state.catalogCharacter ?? characterFilter.value;
    characterFilter.innerHTML = `<option value="">${escapeHtml(t("character.all"))}</option>${CHARACTERS.map(row => `<option value="${row.code}">${String(row.code).padStart(2, "0")} · ${escapeHtml(characterName(row))}</option>`).join("")}`;
    characterFilter.value = CHARACTERS.some(row => String(row.code) === String(catalogCharacter)) ? String(catalogCharacter) : "";
    $("#character-pickers").innerHTML = `<div class="picker"><label for="pick-character">${escapeHtml(t("character.label"))}</label><select id="pick-character"><option value="">${escapeHtml(t("picker.none"))}</option>${CHARACTERS.map(row => `<option value="${row.code}">${String(row.code).padStart(2, "0")} · ${escapeHtml(characterName(row))}</option>`).join("")}</select></div><div class="picker"><label for="pick-character-color">${escapeHtml(t("character.render_color"))}</label><div class="color-choice"><select id="pick-character-color">${characterColors.map(([value, nameKey]) => `<option value="${value}">${escapeHtml(t(nameKey))}</option>`).join("")}</select><span class="color-swatch" id="character-color-swatch" aria-hidden="true"></span></div></div>`;
    $("#pick-character").value = CHARACTERS.some(row => String(row.code) === String(state.character)) ? String(state.character) : "";
    $("#pick-character-color").value = characterColors.some(([value]) => value === state.color) ? state.color : "red";
    $("#costume-pickers").innerHTML = costumeCategories.map(key => `<div class="picker"><div class="picker-label-row"><label for="pick-costume-${key}">${escapeHtml(t(costumeLabels[key]))}</label>${categoryListButton(key, costumeLabels[key])}</div><select id="pick-costume-${key}" data-costume="${key}"></select></div>`).join("");
    $("#pickers").innerHTML = baseCategories.map(key => `<div class="picker"><div class="picker-label-row"><label for="pick-${key}">${escapeHtml(t(baseLabels[key]))}</label>${categoryListButton(key, baseLabels[key])}</div><select id="pick-${key}" data-base="${key}"><option value="">${escapeHtml(t(key === "background" ? "picker.default_background" : key === "flag" ? "picker.default_flag" : "picker.none"))}</option>${(catalogByCategory.get(key) || []).map(row => `<option value="${row.code}">${String(row.code).padStart(4, "0")} · ${escapeHtml(rowLabel(row))}</option>`).join("")}</select></div>`).join("");
    $("#field-pickers").innerHTML = `<div class="picker"><div class="picker-label-row"><label for="pick-bomb">${escapeHtml(t(extraLabels[BOMB_CATEGORY]))}</label>${categoryListButton(BOMB_CATEGORY, extraLabels[BOMB_CATEGORY])}</div><select id="pick-bomb"><option value="">${escapeHtml(t("picker.default_bomb"))}</option>${bombs.map(row => `<option value="${row.code}">${String(row.code).padStart(4, "0")} · ${escapeHtml(rowLabel(row))}${row.connected ? ` · ${escapeHtml(t("bomb.connected_short", {count:row.connected_state_count}))}` : ""}</option>`).join("")}</select></div>`;
    $("#pick-id-deco").innerHTML = `<option value="">${escapeHtml(t("picker.none"))}</option>${idDecorations.map(row => `<option value="${row.code}">${String(row.code).padStart(4, "0")} · ${escapeHtml(rowLabel(row))}</option>`).join("")}`;
    for (const key of baseCategories) $(`#pick-${key}`).value = state.bases?.[key] ?? "";
    $("#pick-bomb").value = state.bomb ?? "";
    $("#pick-id-deco").value = state.idDeco ?? "";
    refreshCostumePickers(state.costumes || {});
    $("#character-color-swatch").style.background = colorSwatch($("#pick-character-color").value);
    $("#render-id-deco").disabled = !selectedIdDecoration();
  }

  function selectedRowForCategory(key) {
    if (baseCategories.includes(key)) return selectedBaseRow(key);
    if (costumeCategories.includes(key)) return selectedCostume(key);
    if (key === ID_DECO_CATEGORY) return selectedIdDecoration();
    return key === BOMB_CATEGORY ? selectedBomb() : null;
  }

  function openCategoryList(nextCategory) {
    if (!Object.hasOwn(categoryLabels, nextCategory)) return false;
    const selectedRow = selectedRowForCategory(nextCategory);
    search.value = "";
    if (costumeCategories.includes(nextCategory)) characterFilter.value = selectedCharacter()?.code ?? "";
    category = nextCategory;
    renderTabs();
    showCurrent();
    requestAnimationFrame(() => {
      const card = selectedRow ? [...grid.querySelectorAll(".card")].find(candidate => candidate.dataset.key === selectedRow.key) : null;
      if (!card) { window.scrollTo({top:0, behavior:"smooth"}); return; }
      card.classList.add("catalog-focus");
      card.scrollIntoView({behavior:"smooth", block:"center", inline:"nearest"});
      card.focus({preventScroll:true});
      setTimeout(() => card.classList.remove("catalog-focus"), 1800);
    });
    return true;
  }

  function setupComposer() {
    renderComposerPickers({character:10, color:"red"});
    $("#character-pickers").addEventListener("change", event => {
      if (event.target.id === "pick-character") refreshCostumePickers();
      if (event.target.id === "pick-character-color") $("#character-color-swatch").style.background = colorSwatch(selectedColor());
      rebuildComposer();
    });
    $("#costume-pickers").addEventListener("change", rebuildComposer);
    $("#pickers").addEventListener("change", rebuildComposer);
    $("#field-pickers").addEventListener("change", () => {
      resetMovementBombs();
      rebuildComposer();
    });
    $("#pick-id-deco").addEventListener("change", () => {
      $("#render-id-deco").disabled = !selectedIdDecoration();
      rebuildComposer();
    });
    $("#movement-scale-control").addEventListener("click", event => {
      const button = event.target.closest("[data-movement-scale]");
      if (button) setMovementRenderScale(button.dataset.movementScale);
    });
    setMovementRenderScale(DEFAULT_MOVEMENT_RENDER_SCALE);
    $("#render").addEventListener("click", renderCompositionGif);
    $("#render-id-deco").addEventListener("click", renderIdDecoGif);
    $("#composer").addEventListener("click", event => {
      const button = event.target.closest("[data-open-category]");
      if (button) openCategoryList(button.dataset.openCategory);
    });
  }

  function tryCurrentItem() {
    const row = lookupRow($("#try-item").dataset.key); if (!row) return;
    if (row.category === ID_DECO_CATEGORY) {
      $("#pick-id-deco").value = String(row.code);
      $("#render-id-deco").disabled = false;
    } else if (row.category === BOMB_CATEGORY) {
      $("#pick-bomb").value = String(row.code);
      resetMovementBombs();
    } else if (baseCategories.includes(row.category)) {
      const select = $(`#pick-${row.category}`); select.value = String(row.code);
    } else {
      const character = selectedCharacter();
      const catalogCharacter = selectedCatalogCharacter();
      const catalogCanWear = catalogCharacter && (row.character_slot == null || compatibleCostumeSlots(catalogCharacter).has(row.character_slot));
      const compatibleSlots = compatibleCostumeSlots(character);
      if (catalogCanWear) $("#pick-character").value = String(catalogCharacter.code);
      else if (row.character_slot != null && !compatibleSlots.has(row.character_slot)) $("#pick-character").value = String(row.character_slot);
      else if (!selectedCharacter()) $("#pick-character").value = String(DEFAULT_CHARACTER_SLOT);
      refreshCostumePickers();
      $(`#pick-costume-${row.category}`).value = row.key;
    }
    category = "tryon"; renderTabs(); showCurrent(); rebuildComposer(); viewer.close(); window.scrollTo({top:0, behavior:"smooth"});
  }

  function gcd(left, right) { while (right) [left, right] = [right, left % right]; return left; }
  function timelineFor(rows) {
    const sources = rows.map(row => {
      const info = sequenceInfo(row, 0); return {row, durations:info.durations, period:info.period};
    }).filter(source => source.period > 0);
    let total = 1;
    for (const source of sources) { const next = total * source.period / gcd(total, source.period); total = next > MAX_GIF_DURATION ? MAX_GIF_DURATION : next; if (total === MAX_GIF_DURATION) break; }
    const points = new Set([0, Math.max(1, total)]);
    for (const source of sources) { let at = 0, index = 0; while (at < total) { points.add(at); at += source.durations[index++ % source.durations.length]; } }
    const times = [...points].filter(value => value <= total).sort((left, right) => left - right);
    return times.slice(0, -1).map((start, index) => ({start, duration:times[index + 1] - start}));
  }

  function gifPalette() {
    const palette = new Uint8Array(768);
    for (let index = 1; index < 253; index++) { const value = index - 1, red = Math.floor(value / 42), remainder = value % 42, green = Math.floor(remainder / 6), blue = remainder % 6; palette[index * 3] = red * 51; palette[index * 3 + 1] = Math.round(green * 255 / 6); palette[index * 3 + 2] = blue * 51; }
    return palette;
  }

  function indexedPixels(image) {
    const source = image.data, output = new Uint8Array(image.width * image.height);
    for (let input = 0, index = 0; input < source.length; input += 4, index++) {
      if (source[input + 3] < 64) { output[index] = 0; continue; }
      output[index] = 1 + Math.round(source[input] / 51) * 42 + Math.round(source[input + 1] * 6 / 255) * 6 + Math.round(source[input + 2] / 51);
    }
    return output;
  }

  function lzw(data) {
    const clear = 256, end = 257, bytes = []; let current = 0, bits = 0, next = 258, dictionary = new Map();
    const put = code => { current |= code << bits; bits += 9; while (bits >= 8) { bytes.push(current & 255); current >>>= 8; bits -= 8; } };
    const reset = () => { dictionary = new Map(); next = 258; };
    put(clear); let prefix = data[0];
    for (let index = 1; index < data.length; index++) { const value = data[index], key = `${prefix},${value}`; if (dictionary.has(key)) prefix = dictionary.get(key); else { put(prefix); if (next < 500) dictionary.set(key, next++); else { put(clear); reset(); } prefix = value; } }
    put(prefix); put(end); if (bits) bytes.push(current & 255); return bytes;
  }

  function word(bytes, value) { bytes.push(value & 255, (value >> 8) & 255); }
  function blocks(bytes, data) { for (let index = 0; index < data.length; index += 255) { const count = Math.min(255, data.length - index); bytes.push(count, ...data.slice(index, index + count)); } bytes.push(0); }
  function makeGif(frames, durations, width, height) {
    const bytes = [71,73,70,56,57,97]; word(bytes, width); word(bytes, height); bytes.push(247,0,0,...gifPalette(),33,255,11,...[..."NETSCAPE2.0"].map(character => character.charCodeAt(0)),3,1,0,0,0);
    frames.forEach((frame, index) => { bytes.push(33,249,4,9); word(bytes, Math.max(2, Math.round(durations[index] / 10))); bytes.push(0,0,44); word(bytes,0); word(bytes,0); word(bytes,width); word(bytes,height); bytes.push(0,8); blocks(bytes,lzw(indexedPixels(frame))); });
    bytes.push(59); return new Blob([new Uint8Array(bytes)], {type:"image/gif"});
  }

  async function renderCompositionGif() {
    const button = $("#render"); button.disabled = true; button.textContent = "…";
    try {
      const renderer = await createCompositionRenderer(), timeline = timelineFor(renderer.timelineRows);
      const canvas = document.createElement("canvas"); canvas.width = SLOT_SIZE; canvas.height = SLOT_SIZE;
      const context = canvas.getContext("2d", {willReadFrequently:true}), frames = [], durations = [];
      for (const segment of timeline) { renderer.draw(context, segment.start); frames.push(context.getImageData(0, 0, SLOT_SIZE, SLOT_SIZE)); durations.push(segment.duration); }
      const url = URL.createObjectURL(makeGif(frames, durations, SLOT_SIZE, SLOT_SIZE)), anchor = document.createElement("a");
      anchor.download = `poptag-${frames.length}-${t("file.frames")}-${Date.now()}.gif`; anchor.href = url; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      button.textContent = t("gif.done");
    } catch (error) { alert(t("gif.failed", {message:error.message})); }
    finally { setTimeout(() => { button.disabled = false; button.textContent = "GIF"; }, 900); }
  }

  async function renderIdDecoGif() {
    const row = selectedIdDecoration(), button = $("#render-id-deco");
    if (!row) return;
    button.disabled = true; button.textContent = "…";
    try {
      const portraitRenderer = await createPortraitRenderer();
      const renderer = await createIdDecoRenderer(row, portraitRenderer), timeline = timelineFor(renderer.timelineRows);
      const canvas = document.createElement("canvas"); canvas.width = ID_DECO_WIDTH; canvas.height = ID_DECO_HEIGHT;
      const context = canvas.getContext("2d", {willReadFrequently:true}), frames = [], durations = [];
      for (const segment of timeline) {
        renderer.draw(context, segment.start);
        frames.push(context.getImageData(0, 0, ID_DECO_WIDTH, ID_DECO_HEIGHT)); durations.push(segment.duration);
      }
      const url = URL.createObjectURL(makeGif(frames, durations, ID_DECO_WIDTH, ID_DECO_HEIGHT)), anchor = document.createElement("a");
      anchor.download = `poptag-id-${String(row.code).padStart(4, "0")}-${frames.length}-${t("file.frames")}.gif`; anchor.href = url; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); button.textContent = t("gif.done");
    } catch (error) { alert(t("gif.failed", {message:error.message})); }
    finally { setTimeout(() => { button.disabled = !selectedIdDecoration(); button.textContent = "GIF"; }, 900); }
  }

  function clearMovementInput(now = performance.now()) {
    heldMovementDirections.clear();
    movementDirectionOrder = [];
    movementState.moving = false;
    movementState.lastDirectionInputAt = now;
  }

  function setMovementInput(direction, pressed, now = performance.now()) {
    movementState.lastDirectionInputAt = now;
    if (pressed) {
      if (!heldMovementDirections.has(direction)) {
        heldMovementDirections.add(direction);
        movementDirectionOrder = movementDirectionOrder.filter(value => value !== direction);
        movementDirectionOrder.push(direction);
        if (!movementState.moving || movementState.direction !== direction) movementState.walkStarted = now;
      }
      movementState.direction = direction;
      movementState.moving = true;
      return;
    }
    heldMovementDirections.delete(direction);
    movementDirectionOrder = movementDirectionOrder.filter(value => value !== direction);
    const next = movementDirectionOrder.at(-1);
    if (next) {
      if (movementState.direction !== next) movementState.walkStarted = now;
      movementState.direction = next;
      movementState.moving = true;
    } else {
      movementState.moving = false;
    }
  }

  function showCurrent() {
    const composing = category === "tryon";
    $("#controls").style.display = composing ? "none" : "grid";
    grid.style.display = composing ? "none" : "grid";
    $("#composer").style.display = composing ? "grid" : "none";
    $("#count").textContent = composing ? "" : $("#count").textContent;
    if (composing) clearGridAnimations();
    else {
      clearMovementInput();
      if (resourceStore) renderGrid();
    }
  }

  async function chooseDirectory() {
    if (!("showDirectoryPicker" in window)) { $("#idd-files").click(); return; }
    try {
      const handle = await window.showDirectoryPicker({mode:"read", id:"poptag-resources"});
      await connectFiles(await filesFromDirectory(handle), handle);
    } catch (error) {
      if (error.name === "AbortError") return;
      if (error.name === "SecurityError" || error.name === "NotSupportedError") { $("#idd-files").click(); return; }
      gateStatus(error.message, "error");
    }
  }

  $("#choose-folder").addEventListener("click", chooseDirectory);
  $("#language-switch").addEventListener("click", event => {
    const button = event.target.closest("[data-language]");
    if (button) setLanguage(button.dataset.language);
  });
  $("#idd-files").addEventListener("change", event => connectFiles(event.target.files));
  [search, sort, characterFilter].forEach(element => element.addEventListener("input", () => resourceStore && renderGrid()));
  $("#size").addEventListener("input", event => { const card = Number(event.target.value), thumb = {170:112,270:180,520:360}[card]; document.documentElement.style.setProperty("--card", `${card}px`); document.documentElement.style.setProperty("--thumb", `${thumb}px`); });
  $("#tabs").addEventListener("click", event => {
    const tab = event.target.closest(".tab");
    if (tab) openCategoryList(tab.dataset.category);
  });
  $("#tryon-tab").addEventListener("click", () => { category = "tryon"; renderTabs(); showCurrent(); rebuildComposer(); });
  grid.addEventListener("click", event => { const card = event.target.closest(".card"); if (card) openRow(lookupRow(card.dataset.key)); });
  $("#try-item").addEventListener("click", tryCurrentItem);
  $("#close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("close", () => { modalAnimation = null; });
  viewer.addEventListener("click", event => { if (event.target === viewer) viewer.close(); });
  $("#movement-canvas").addEventListener("pointerdown", event => event.currentTarget.focus());
  document.addEventListener("keydown", event => {
    const direction = movementDirectionByKey.get(event.key);
    const placeBomb = event.code === "Space";
    const target = event.target;
    if ((!direction && !placeBomb) || category !== "tryon" || viewer.open || event.ctrlKey || event.altKey || event.metaKey) return;
    if (target instanceof Element && target.closest("input,select,textarea,button,[contenteditable='true']")) return;
    if (placeBomb) {
      if (!event.repeat) placeMovementBomb();
      event.preventDefault();
      return;
    }
    setMovementInput(direction, true);
    event.preventDefault();
  });
  document.addEventListener("keyup", event => {
    const direction = movementDirectionByKey.get(event.key);
    if (!direction || !heldMovementDirections.has(direction)) return;
    setMovementInput(direction, false);
    event.preventDefault();
  });
  window.addEventListener("blur", clearMovementInput);
  window.addEventListener("resize", () => {
    if (category === "tryon") updateMovementFieldTileScale(movementCharacterScale());
  });

  applyStaticTranslations(); setupComposer(); updateMovementBombStatus(); renderTabs(); requestAnimationFrame(animationLoop);
  restoreDirectoryHandle().then(async handle => { if (handle) await connectFiles(await filesFromDirectory(handle), handle); }).catch(() => {});
})();

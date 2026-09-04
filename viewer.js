(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const SLOT_SIZE = 148;
  const CHARACTER_DRAW_POINT = [37, 119];
  const DEFAULT_FRAME_DURATION = 120;
  const MAX_GIF_DURATION = 12000;
  const DEFAULT_CHARACTER_SLOT = 5;
  const CACHE_LIMIT = 72;
  const baseLabels = {background:"배경", flag:"깃발", prop:"소품", effect:"효과"};
  const costumeLabels = {expression:"표정", hair:"가발", head:"모자", mask:"가면", outfit:"의상", accessory:"액세서리", wing:"날개", special:"특수효과"};
  const categoryLabels = {...baseLabels, ...costumeLabels};
  const baseCategories = Object.keys(baseLabels);
  const costumeCategories = Object.keys(costumeLabels);
  const costumeInheritance = new Map([[10,4],[11,7],[12,6],[14,0],[15,8],[17,2],[18,1],[25,9],[27,19],[28,26],[29,16]]);
  const costumeTrackingVariants = {expression:"A", mask:"A", hair:"C", head:"C", outfit:"B", accessory:"B"};
  const characterColors = [
    ["red", "빨강", "#fe0000"], ["yellow", "노랑", "#ffca10"],
    ["orange", "주황", "#ff9800"], ["green", "초록", "#7dc709"],
    ["cyan", "청록", "#00c6cd"], ["blue", "파랑", "#006fee"],
    ["purple", "보라", "#791fe6"], ["pink", "분홍", "#bf005f"],
  ];
  const colorRgb = Object.fromEntries(characterColors.map(([key, _name, hex]) => [key, [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))]));
  const catalogByCategory = new Map(baseCategories.map(category => [category, CATALOG.filter(row => row.category === category)]));
  const costumesByCategory = new Map(costumeCategories.map(category => [category, COSTUMES.filter(row => row.category === category)]));
  const costumeByKey = new Map(COSTUMES.map(row => [row.key, row]));
  const characterBySlot = new Map(CHARACTERS.map(row => [row.code, row]));
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
  let lastAnimationTick = 0;

  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;"}[character]));
  const rowLabel = row => row.item_names?.length ? row.item_names.join(" / ") : "이름 없음 · 리소스만 있음";
  const rowResource = row => row.render_resource || row.resource;
  const rowsForCategory = value => baseCategories.includes(value) ? (catalogByCategory.get(value) || []) : (costumesByCategory.get(value) || []);
  const rowPrefix = row => ({background:"BG", flag:"FLAG", prop:"PROP", effect:"FX", expression:"FACE", hair:"HAIR", head:"HEAD", mask:"MASK", outfit:"OUTFIT", accessory:"ACC", wing:"WING", special:"SPECIAL"}[row.category] || row.category.toUpperCase());
  const rowCode = row => `${rowPrefix(row)} ${String(row.code).padStart(4, "0")}`;

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
      if (!count) throw new Error("잘못된 24비트 RLE 토큰입니다.");
      if (token & 0x80) {
        pixel += count;
      } else if (token & 0x40) {
        if (position + 3 > end) throw new Error("24비트 RLE 반복값이 잘렸습니다.");
        const blue = bytes[position++], green = bytes[position++], red = bytes[position++];
        const rgba = (special && specialColor(red, green, blue)) || [red, green, blue, 255];
        for (let index = 0; index < count && pixel < pixelCount; index++, pixel++) pixels.set(rgba, pixel * 4);
      } else {
        if (position + count * 3 > end) throw new Error("24비트 RLE 값이 잘렸습니다.");
        for (let index = 0; index < count; index++, pixel++) {
          const blue = bytes[position++], green = bytes[position++], red = bytes[position++];
          pixels.set((special && specialColor(red, green, blue)) || [red, green, blue, 255], pixel * 4);
        }
      }
    }
    if (pixel < pixelCount) throw new Error("24비트 RLE 픽셀이 부족합니다.");
    return {pixels, position};
  }

  function decodeAlpha(bytes, start, end, pixels, pixelCount) {
    for (let index = 3; index < pixels.length; index += 4) pixels[index] = 0;
    let position = start, pixel = 0;
    while (pixel < pixelCount && position < end) {
      const token = bytes[position++], count = token & 0x3f;
      if (!count) throw new Error("잘못된 알파 RLE 토큰입니다.");
      if (token & 0x80) {
        pixel += count;
      } else if (token & 0x40) {
        if (position >= end) throw new Error("알파 RLE 반복값이 잘렸습니다.");
        const alpha = bytes[position++];
        for (let index = 0; index < count && pixel < pixelCount; index++, pixel++) pixels[pixel * 4 + 3] = alpha;
      } else {
        if (position + count > end) throw new Error("알파 RLE 값이 잘렸습니다.");
        for (let index = 0; index < count; index++, pixel++) pixels[pixel * 4 + 3] = bytes[position++];
      }
    }
    if (pixel < pixelCount) throw new Error("알파 RLE 픽셀이 부족합니다.");
  }

  function decodeRle565(bytes, start, end, pixelCount) {
    const pixels = new Uint8ClampedArray(pixelCount * 4);
    let position = start, pixel = 0;
    while (pixel < pixelCount && position < end) {
      const token = bytes[position++], count = token & 0x3f;
      if (!count) throw new Error("잘못된 565 RLE 토큰입니다.");
      if (token & 0x80) {
        pixel += count;
        continue;
      }
      const repeat = Boolean(token & 0x40);
      if (position + (repeat ? 2 : count * 2) > end) throw new Error("565 RLE 값이 잘렸습니다.");
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
    if (pixel < pixelCount) throw new Error("565 RLE 픽셀이 부족합니다.");
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
        if (alphaStart < start + 5 || alphaStart >= end) throw new Error("알파 스트림 위치가 잘못되었습니다.");
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
    if (bytes.length < 24) throw new Error("레거시 리소스가 너무 짧습니다.");
    const frameCount = u32(view, 0), width = u32(view, 8), height = u32(view, 12);
    if (!frameCount || !width || !height || width * height > 2500000) throw new Error("레거시 리소스 크기가 잘못되었습니다.");
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
    if (!frameCount || frameCount >= 4096 || !textureCount || textureCount >= 4096) throw new Error("리소스 헤더가 잘못되었습니다.");
    const sizesOffset = 16, recordsOffset = sizesOffset + textureCount * 8, chunksOffset = recordsOffset + frameCount * 48;
    if (chunksOffset + 4 > bytes.length) throw new Error("리소스 메타데이터가 잘렸습니다.");
    const dimensions = [];
    for (let index = 0; index < textureCount; index++) dimensions.push([u32(view, sizesOffset + index * 8 + 4), u32(view, sizesOffset + index * 8)]);
    const chunks = [];
    let position = chunksOffset;
    for (let index = 0; index < textureCount; index++) {
      if (position + 4 > bytes.length) throw new Error("텍스처 길이가 잘렸습니다.");
      const length = u32(view, position); position += 4;
      if (position + length > bytes.length) throw new Error("텍스처 데이터가 잘렸습니다.");
      chunks.push([position, length]); position += length;
    }
    const textureCanvases = new Map(), frames = [], records = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const offset = recordsOffset + frameIndex * 48;
      const values = Array.from({length:12}, (_, index) => i32(view, offset + index * 4));
      const [originX, originY, _blend, textureIndex, rawLeft, rawTop, rawRight, rawBottom, rawCanvasWidth, rawCanvasHeight, anchorX, anchorY] = values;
      if (textureIndex < 0 || textureIndex >= textureCount) throw new Error("텍스처 번호가 잘못되었습니다.");
      const [textureWidth, textureHeight] = dimensions[textureIndex];
      const left = Math.max(0, rawLeft), top = Math.max(0, rawTop), right = Math.min(textureWidth, rawRight), bottom = Math.min(textureHeight, rawBottom);
      const cropWidth = Math.max(0, right - left), cropHeight = Math.max(0, bottom - top);
      const canvasWidth = rawCanvasWidth > 0 && rawCanvasWidth <= 8192 ? rawCanvasWidth : cropWidth;
      const canvasHeight = rawCanvasHeight > 0 && rawCanvasHeight <= 8192 ? rawCanvasHeight : cropHeight;
      if (!canvasWidth || !canvasHeight || canvasWidth * canvasHeight > 2500000) throw new Error("프레임 크기가 잘못되었습니다.");
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
      if (!record || !file) throw new Error(`리소스를 찾을 수 없습니다: ${key}`);
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
      if (!file) throw new Error(`${expected.name} 파일이 없습니다.`);
      if (file.size !== expected.size) throw new Error(`${expected.name} 크기가 현재 카탈로그와 다릅니다.`);
      if (crypto?.subtle) {
        const sample = expected.sample_size;
        const [head, tail] = await Promise.all([
          sha256Hex(file.slice(0, Math.min(sample, file.size))),
          sha256Hex(file.slice(Math.max(0, file.size - sample), file.size)),
        ]);
        if (head !== expected.head_sha256 || tail !== expected.tail_sha256) throw new Error(`${expected.name} 버전이 현재 카탈로그와 다릅니다.`);
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
      button.textContent = "PopTag 폴더 선택";
      alert(message);
      return;
    }
    button.disabled = message.includes("확인");
    button.textContent = button.disabled ? "확인 중…" : "PopTag 폴더 선택";
  }

  async function connectFiles(files, handle = null) {
    gateStatus("IDD 파일을 확인하는 중…");
    try {
      resourceStore = new ResourceStore(await validateFiles(files));
      if (handle) await saveDirectoryHandle(handle);
      gateStatus("연결되었습니다.", "ok");
      $("#resource-gate").classList.add("ready");
      renderTabs(); showCurrent(); rebuildComposer();
    } catch (error) {
      resourceStore = null; gateStatus(error.message, "error");
    }
  }

  function toCanvas(source, colorKey) {
    if (!colorKey || colorKey === "red") return source;
    source._tints ||= new Map();
    if (source._tints.has(colorKey)) return source._tints.get(colorKey);
    const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext("2d", {willReadFrequently:true}); context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
    const target = rgbToHsv(...colorRgb[colorKey])[0];
    for (let index = 0; index < data.length; index += 4) {
      if (!data[index + 3]) continue;
      const [hue, saturation, value] = rgbToHsv(data[index], data[index + 1], data[index + 2]);
      if (saturation <= .01) continue;
      const [red, green, blue] = hsvToRgb((hue + target) % 1, saturation, value);
      data[index] = red; data[index + 1] = green; data[index + 2] = blue;
    }
    context.putImageData(image, 0, 0); source._tints.set(colorKey, canvas); return canvas;
  }

  function rgbToHsv(red, green, blue) {
    red /= 255; green /= 255; blue /= 255;
    const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue), delta = maximum - minimum;
    let hue = 0;
    if (delta) {
      if (maximum === red) hue = ((green - blue) / delta) % 6;
      else if (maximum === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue = (hue / 6 + 1) % 1;
    }
    return [hue, maximum ? delta / maximum : 0, maximum];
  }

  function hsvToRgb(hue, saturation, value) {
    const index = Math.floor(hue * 6), fraction = hue * 6 - index;
    const p = value * (1 - saturation), q = value * (1 - fraction * saturation), t = value * (1 - (1 - fraction) * saturation);
    const values = [[value,t,p],[q,value,p],[p,value,t],[p,q,value],[t,p,value],[value,p,q]][index % 6];
    return values.map(channel => Math.round(channel * 255));
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

  async function prepareParts(row) {
    return Promise.all((row.parts || row.resource_entries || []).map(async part => {
      const descriptor = typeof part === "string" ? {resource:part, adjust:false} : part;
      return {...descriptor, decoded:await resourceStore.get(row.archive, descriptor.resource)};
    }));
  }

  function drawCentered(context, decoded, sourceIndex) {
    const frame = decoded.frames[sourceIndex % decoded.frames.length];
    context.drawImage(frame.canvas, Math.floor((SLOT_SIZE - decoded.maxWidth) / 2), Math.floor((SLOT_SIZE - decoded.maxHeight) / 2));
  }

  function drawPositioned(context, part, sourceIndex, colorKey = "red", offset = [0, 0]) {
    const frame = part.decoded.frames[sourceIndex % part.decoded.frames.length];
    const record = frame.record;
    const source = part.adjust ? toCanvas(frame.canvas, colorKey) : frame.canvas;
    context.drawImage(source, CHARACTER_DRAW_POINT[0] - record.anchorX + offset[0], CHARACTER_DRAW_POINT[1] - record.anchorY + offset[1]);
  }

  function drawParts(context, parts, sourceIndex, colorKey, variants = null, offset = [0, 0]) {
    for (const part of parts) {
      if (variants && !variants.has(part.variant)) continue;
      drawPositioned(context, part, sourceIndex, colorKey, offset);
    }
  }

  function characterPartOffset(characterParts, sourceIndex, preferredVariant) {
    const hasPixels = frame => frame && frame.record.right > frame.record.left && frame.record.bottom > frame.record.top;
    const candidates = characterParts.filter(part => part.variant === preferredVariant).sort((left, right) => Number(left.adjust) - Number(right.adjust));
    const tracker = candidates.find(part => hasPixels(part.decoded.frames[0]) && hasPixels(part.decoded.frames[sourceIndex % part.decoded.frames.length]));
    if (!tracker) return preferredVariant === "A" ? [0, 0] : characterPartOffset(characterParts, sourceIndex, "A");
    const base = tracker.decoded.frames[0].record;
    const current = tracker.decoded.frames[sourceIndex % tracker.decoded.frames.length].record;
    return [base.originX - current.originX, base.originY - current.originY];
  }

  function costumePoseOffset(row, characterParts, sourceIndex) {
    if (row.pose_frame == null) return [0, 0];
    const trackingVariant = costumeTrackingVariants[row.category] || "A";
    return characterPartOffset(characterParts, sourceIndex, trackingVariant);
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

  async function createCostumePreviewRenderer(row) {
    const selected = selectedCatalogCharacter();
    const selectedCanWear = selected && (row.character_slot == null || compatibleCostumeSlots(selected).has(row.character_slot));
    const character = selectedCanWear ? selected : characterBySlot.get(row.character_slot ?? DEFAULT_CHARACTER_SLOT) || CHARACTERS[0];
    const [characterParts, costumeParts] = await Promise.all([prepareParts(character), prepareParts(row)]);
    return {
      draw(context, elapsed) {
        const characterInfo = sequenceInfo(character, elapsed), costumeInfo = row.pose_frame != null ? {sourceIndex:row.pose_frame, sequenceIndex:0} : row.sync_character ? {sourceIndex:characterInfo.sourceIndex, sequenceIndex:characterInfo.sequenceIndex} : sequenceInfo(row, elapsed);
        const costumeOffset = costumePoseOffset(row, characterParts, characterInfo.sourceIndex);
        context.clearRect(0, 0, SLOT_SIZE, SLOT_SIZE);
        const hairSelected = row.category === "hair", outfitSelected = row.category === "outfit";
        if (row.render_plane === "back") drawParts(context, costumeParts, costumeInfo.sourceIndex, "red", null, costumeOffset);
        const baseVariants = new Set(outfitSelected ? ["A"] : ["A", "B"]);
        drawParts(context, characterParts, characterInfo.sourceIndex, "red", baseVariants);
        if (row.render_plane === "front" && row.category === "outfit") drawParts(context, costumeParts, costumeInfo.sourceIndex, "red", null, costumeOffset);
        if (row.render_plane === "front" && row.category === "expression") drawParts(context, costumeParts, costumeInfo.sourceIndex, "red", null, costumeOffset);
        if (!hairSelected) drawParts(context, characterParts, characterInfo.sourceIndex, "red", new Set(["C"]));
        if (row.render_plane === "front" && !["outfit", "expression"].includes(row.category)) drawParts(context, costumeParts, costumeInfo.sourceIndex, "red", null, costumeOffset);
        return `${characterInfo.sourceIndex}:${costumeInfo.sourceIndex}`;
      },
    };
  }

  async function createRowRenderer(row) { return baseCategories.includes(row.category) ? createBaseRenderer(row) : createCostumePreviewRenderer(row); }

  function animationLoop(now) {
    if (now - lastAnimationTick >= 45) {
      lastAnimationTick = now;
      for (const item of previewAnimations.values()) drawAnimationItem(item, now);
      if (modalAnimation) drawAnimationItem(modalAnimation, now);
      if (composerAnimation) drawAnimationItem(composerAnimation, now);
    }
    requestAnimationFrame(animationLoop);
  }

  function drawAnimationItem(item, now) {
    try {
      const elapsed = now - item.started;
      const signature = item.renderer.draw(item.context, elapsed);
      item.signature = signature;
    } catch (error) {
      item.context.clearRect(0, 0, SLOT_SIZE, SLOT_SIZE);
      item.context.fillStyle = "#842f38"; item.context.font = "10px sans-serif"; item.context.fillText("렌더 오류", 8, 18);
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
          const context = canvas.getContext("2d"); context.fillStyle = "#842f38"; context.fillRect(0, 0, SLOT_SIZE, SLOT_SIZE); console.error(error);
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
    const buttons = keys => keys.map(key => `<button class="tab ${key === category ? "active" : ""}" data-category="${key}">${categoryLabels[key]} <span>${rowsForCategory(key).length.toLocaleString()}</span></button>`).join("");
    $("#base-tabs").innerHTML = buttons(baseCategories);
    $("#costume-tabs").innerHTML = buttons(costumeCategories);
    $("#tryon-tab").classList.toggle("active", category === "tryon");
    $("#tryon-tab").setAttribute("aria-pressed", String(category === "tryon"));
    characterFilter.hidden = !costumeCategories.includes(category);
  }

  function renderGrid() {
    clearGridAnimations();
    const rows = filteredRows(), selected = selectedCatalogCharacter(), compatibleSlots = compatibleCostumeSlots(selected);
    const total = rowsForCategory(category).filter(row => !selected || row.character_slot == null || compatibleSlots.has(row.character_slot)).length;
    $("#count").textContent = `${rows.length.toLocaleString()} / ${total.toLocaleString()}개`;
    grid.innerHTML = rows.length ? rows.map(row => `<button class="card ${row.item_table_linked ? "" : "unlinked"}" data-key="${escapeHtml(row.key)}"><div class="preview-shell"><canvas class="thumb" width="148" height="148" aria-label="${escapeHtml(categoryLabels[row.category])} ${String(row.code).padStart(4, "0")} 미리보기"></canvas></div><div class="body"><div class="row"><span class="code">${escapeHtml(rowCode(row))}</span><span class="badge">${row.frame_count > 1 ? "GIF · " : ""}${row.frame_count} 프레임</span></div><div class="name">${escapeHtml(rowLabel(row))}</div><div class="resource">${escapeHtml(rowResource(row))}</div></div></button>`).join("") : `<div class="empty">조건에 맞는 항목이 없습니다.</div>`;
    for (const [index, canvas] of [...document.querySelectorAll("canvas.thumb")].entries()) canvas._row = rows[index];
    observePreviews();
  }

  function lookupRow(key) { return CATALOG.find(row => row.key === key) || costumeByKey.get(key); }

  async function openRow(row) {
    if (!row) return;
    $("#vcode").textContent = `${rowCode(row)} · ${row.frame_count} 프레임`;
    $("#vname").textContent = rowLabel(row);
    const tryButton = $("#try-item"); tryButton.dataset.key = row.key;
    const details = [
      ["종류", categoryLabels[row.category]], ["리소스", rowResource(row)],
      ["크기", row.frame_dimensions.join(", ")], ["표시 형식", row.frame_count > 1 ? "움직이는 GIF" : "정지 이미지"],
      ["아이템 ID", row.item_ids?.length ? row.item_ids.join(", ") : "없음"],
    ];
    $("#details").innerHTML = details.map(([key, value]) => `<div class="detail"><small>${key}</small><div>${escapeHtml(value)}</div></div>`).join("");
    viewer.showModal();
    try {
      const renderer = await createRowRenderer(row);
      const canvas = $("#modal-canvas");
      modalAnimation = {renderer, context:canvas.getContext("2d"), started:performance.now(), signature:""};
      drawAnimationItem(modalAnimation, performance.now());
    } catch (error) { alert(`미리보기를 만들지 못했습니다. ${error.message}`); }
  }

  function selectedBaseRow(key) {
    const value = $(`#pick-${key}`)?.value;
    return value ? (catalogByCategory.get(key) || []).find(row => String(row.code) === value) : null;
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
    const [defaultBackground, defaultFlag, characterParts, ...loaded] = await Promise.all([
      prepareDefaultBackground(), prepareDefaultFlag(), character ? prepareParts(character) : Promise.resolve([]),
      ...baseCategories.map(key => baseRows[key] ? prepareParts(baseRows[key]) : Promise.resolve([])),
      ...costumeCategories.map(key => costumeRows[key] ? prepareParts(costumeRows[key]) : Promise.resolve([])),
    ]);
    const baseParts = Object.fromEntries(baseCategories.map((key, index) => [key, loaded[index]]));
    const costumeParts = Object.fromEntries(costumeCategories.map((key, index) => [key, loaded[baseCategories.length + index]]));
    const color = selectedColor();
    const drawCostume = (context, key, elapsed, characterSource) => {
      const row = costumeRows[key]; if (!row) return "-";
      const info = row.pose_frame != null ? {sourceIndex:row.pose_frame} : row.sync_character && characterSource != null ? {sourceIndex:characterSource} : sequenceInfo(row, elapsed);
      const offset = costumePoseOffset(row, characterParts, characterSource ?? 0);
      drawParts(context, costumeParts[key], info.sourceIndex, color, null, offset); return `${info.sourceIndex}@${offset.join(",")}`;
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

  let composerBuild = 0;
  async function rebuildComposer() {
    if (!resourceStore) return;
    const generation = ++composerBuild;
    try {
      const renderer = await createCompositionRenderer();
      if (generation !== composerBuild) return;
      composerAnimation = {renderer, context:$("#stage-canvas").getContext("2d"), started:performance.now(), signature:""};
      drawAnimationItem(composerAnimation, performance.now());
    } catch (error) { console.error(error); }
  }

  function refreshCostumePickers() {
    const character = selectedCharacter();
    const compatibleSlots = compatibleCostumeSlots(character);
    for (const key of costumeCategories) {
      const select = $(`#pick-costume-${key}`), previous = select.value;
      const compatible = (costumesByCategory.get(key) || []).filter(row => row.character_slot == null || compatibleSlots.has(row.character_slot));
      const slotRank = row => row.character_slot == null ? 0 : row.character_slot === character?.code ? 1 : 2;
      compatible.sort((left, right) => slotRank(left) - slotRank(right) || left.code - right.code || rowLabel(left).localeCompare(rowLabel(right), "ko"));
      select.innerHTML = `<option value="">착용 안 함</option>${compatible.map(row => `<option value="${escapeHtml(row.key)}">${row.character_slot == null ? "공용" : `${String(row.character_slot).padStart(2, "0")} 전용`} · ${String(row.code).padStart(4, "0")} · ${escapeHtml(rowLabel(row))}</option>`).join("")}`;
      select.value = compatible.some(row => row.key === previous) ? previous : "";
      select.disabled = !compatible.length;
    }
  }

  function setupComposer() {
    characterFilter.innerHTML = `<option value="">전체 캐릭터</option>${CHARACTERS.map(row => `<option value="${row.code}">${String(row.code).padStart(2, "0")} · ${escapeHtml(rowLabel(row))}</option>`).join("")}`;
    $("#character-pickers").innerHTML = `<div class="picker"><label for="pick-character">캐릭터</label><select id="pick-character"><option value="">착용 안 함</option>${CHARACTERS.map(row => `<option value="${row.code}">${String(row.code).padStart(2, "0")} · ${escapeHtml(rowLabel(row))}</option>`).join("")}</select></div><div class="picker"><label for="pick-character-color">캐릭터 렌더색</label><div class="color-choice"><select id="pick-character-color">${characterColors.map(([value, name]) => `<option value="${value}" ${value === "red" ? "selected" : ""}>${name}</option>`).join("")}</select><span class="color-swatch" id="character-color-swatch" aria-hidden="true"></span></div></div>`;
    $("#costume-pickers").innerHTML = costumeCategories.map(key => `<div class="picker"><label for="pick-costume-${key}">${costumeLabels[key]}</label><select id="pick-costume-${key}" data-costume="${key}"></select></div>`).join("");
    $("#pickers").innerHTML = baseCategories.map(key => `<div class="picker"><label for="pick-${key}">${baseLabels[key]}</label><select id="pick-${key}" data-base="${key}"><option value="">${key === "background" ? "기본 배경" : key === "flag" ? "기본 깃발" : "착용 안 함"}</option>${(catalogByCategory.get(key) || []).map(row => `<option value="${row.code}">${String(row.code).padStart(4, "0")} · ${escapeHtml(rowLabel(row))}</option>`).join("")}</select></div>`).join("") + `<button class="render-button" id="render" type="button">GIF</button>`;
    $("#character-color-swatch").style.background = colorRgb.red ? "#fe0000" : "red";
    refreshCostumePickers();
    $("#character-pickers").addEventListener("change", event => {
      if (event.target.id === "pick-character") refreshCostumePickers();
      if (event.target.id === "pick-character-color") $("#character-color-swatch").style.background = characterColors.find(([key]) => key === selectedColor())[2];
      rebuildComposer();
    });
    $("#costume-pickers").addEventListener("change", rebuildComposer);
    $("#pickers").addEventListener("change", rebuildComposer);
    $("#render").addEventListener("click", renderCompositionGif);
  }

  function tryCurrentItem() {
    const row = lookupRow($("#try-item").dataset.key); if (!row) return;
    if (baseCategories.includes(row.category)) {
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
    const button = $("#render"); button.disabled = true; button.textContent = "만드는 중…";
    try {
      const renderer = await createCompositionRenderer(), timeline = timelineFor(renderer.timelineRows);
      const canvas = document.createElement("canvas"); canvas.width = SLOT_SIZE; canvas.height = SLOT_SIZE;
      const context = canvas.getContext("2d", {willReadFrequently:true}), frames = [], durations = [];
      for (const segment of timeline) { renderer.draw(context, segment.start); frames.push(context.getImageData(0, 0, SLOT_SIZE, SLOT_SIZE)); durations.push(segment.duration); }
      const url = URL.createObjectURL(makeGif(frames, durations, SLOT_SIZE, SLOT_SIZE)), anchor = document.createElement("a");
      anchor.download = `poptag-${frames.length}프레임-${Date.now()}.gif`; anchor.href = url; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      button.textContent = `${frames.length}프레임 저장 완료`;
    } catch (error) { alert(`GIF 저장에 실패했습니다. ${error.message}`); }
    finally { setTimeout(() => { button.disabled = false; button.textContent = "GIF"; }, 900); }
  }

  function showCurrent() {
    const composing = category === "tryon";
    $("#controls").style.display = composing ? "none" : "grid";
    grid.style.display = composing ? "none" : "grid";
    $("#composer").style.display = composing ? "grid" : "none";
    $("#count").textContent = composing ? "" : $("#count").textContent;
    if (composing) clearGridAnimations(); else if (resourceStore) renderGrid();
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
  $("#idd-files").addEventListener("change", event => connectFiles(event.target.files));
  [search, sort, characterFilter].forEach(element => element.addEventListener("input", () => resourceStore && renderGrid()));
  $("#size").addEventListener("input", event => { const card = Number(event.target.value), thumb = {170:112,270:180,520:360}[card]; document.documentElement.style.setProperty("--card", `${card}px`); document.documentElement.style.setProperty("--thumb", `${thumb}px`); });
  $("#tabs").addEventListener("click", event => { const tab = event.target.closest(".tab"); if (!tab) return; category = tab.dataset.category; renderTabs(); showCurrent(); });
  $("#tryon-tab").addEventListener("click", () => { category = "tryon"; renderTabs(); showCurrent(); rebuildComposer(); });
  grid.addEventListener("click", event => { const card = event.target.closest(".card"); if (card) openRow(lookupRow(card.dataset.key)); });
  $("#try-item").addEventListener("click", tryCurrentItem);
  $("#close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("close", () => { modalAnimation = null; });
  viewer.addEventListener("click", event => { if (event.target === viewer) viewer.close(); });

  setupComposer(); renderTabs(); requestAnimationFrame(animationLoop);
  restoreDirectoryHandle().then(async handle => { if (handle) await connectFiles(await filesFromDirectory(handle), handle); }).catch(() => {});
})();

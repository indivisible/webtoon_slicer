import * as noUiSlider from "nouislider";
import JSZip from "jszip";

const DEFAULT_PAGE_SIZE = 3500;
const DEFAULT_WARN_DIFFERENCE = 1000;
// how many pixels away will we add new pins
const PIN_STEP = 100;
const DEFAULT_FILENAME_PREFIX = 'page_';

let images: HTMLImageElement[] = [];
let goodBreakPositions: number[] = [];
let stripHeight = 0;
let stripWidth = 0;
let imageContainer: HTMLElement;
let slider: HTMLElement;
let sliderAPI: noUiSlider.API;
let debugLog = "";
const labelFormatter = {
  to: (num: number) => Math.floor(num).toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
};

function getInput(selector: string): HTMLInputElement {
  return document.querySelector(selector) as HTMLInputElement;
}

function getInputNumber(selector: string, defaultValue: number) {
  const input = getInput(selector);
  if(input && input.validity.valid){
    return input.valueAsNumber;
  }
  return defaultValue;
}

function getPageSize(){
  return getInputNumber('#page-size-input', DEFAULT_PAGE_SIZE);
}

function getWarnDifference(){
  return getInputNumber('#page-size-difference-input', DEFAULT_WARN_DIFFERENCE);
}

function log(value: any){
  console.log(value);
  debugLog += '\n' + value;
  const elem = document.querySelector('#log') as HTMLElement;
  if (elem)
    elem.innerText = debugLog;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", err => reject(err));
    img.dataset["name"] = file.name;
    img.src = URL.createObjectURL(file);
  });
}

// find monochromatic regions of the strip and designate their starts
// and ends as good points to insert a break
function calculateBreaks(){
  type Pixel = number[] | Uint8ClampedArray;
  goodBreakPositions = [];
  // "complex" means the line is not monochromatic
  let prevComplex = true;
  let prevColor: Pixel = [0, 0, 0];
  let imageStartY = 0;
  const canvas = document.createElement('canvas');
  // RGB pixel comparision (ignores alpha)
  const comparePixel = (a: Pixel, b: Pixel) => {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  };
  for(const img of images){
    const size = getScaledSize(img);
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw "Error creating canvas context! Try a newer browser!";
    }
    ctx.drawImage(img, 0, 0);
    // image as an RGBA array
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let rowBase=0, unscaledY=0; rowBase < data.length; rowBase += img.naturalWidth * 4, unscaledY++) {
      let complex = false;
      const color = data.slice(rowBase, rowBase+3);
      // start from the 2nd pixel (pos = 4)
      for(let pos = 4; pos < stripWidth*4; pos += 4){
        const px = data.slice(rowBase+pos, rowBase+pos+3);
        if(!comparePixel(color, px)){
          complex = true;
          break;
        }
      }
      const y = imageStartY + Math.round(unscaledY * size.scale);
      if(complex != prevComplex){
        // it's either the start or end of a monochromatic region
        goodBreakPositions.push(y);
      }else if(!complex && !comparePixel(color, prevColor)){
        // we're at the border of 2 different colored regions
        goodBreakPositions.push(y);
      }
      prevComplex = complex;
      prevColor = color;
    }
    imageStartY += size.height;
  }
}

function getBestWidth (images: HTMLImageElement[]) {
  const widthCounts: {[width: number]: number} = {};
  let maxCount = 0;
  let bestWidth = 0;
  for (const img of images) {
    const w = img.naturalWidth;
    if (!widthCounts[w]) {
      widthCounts[w] = 0;
    }
    widthCounts[w]++;
    if (widthCounts[w] > maxCount) {
      maxCount = widthCounts[w];
      bestWidth = w;
    }
  }
  return bestWidth;
}

function getScaledSize (img: HTMLImageElement) {
  const scale = stripWidth / img.naturalWidth;
  return {
    width: stripWidth,
    height: Math.round(img.naturalHeight * scale),
    scale
  }
}

async function loadImages(files: FileList | []): Promise<void> {
  $('#loadingModal').modal('show');
  imageContainer.innerHTML = '';
  destroySlider();
  for(const img of images){
    URL.revokeObjectURL(img.src);
  }
  images = [];
  stripHeight = 0;
  stripWidth = 0;
  try {
    // inside try block so finally will run
    if (files.length === 0) {
      // clear the "Pages" list
      updateSliceSizes([]);
      return;
    }
    images = await Promise.all(Array.from(files).map(loadImage));
    stripWidth = getBestWidth(images);
    stripHeight = 0;
    for(const img of images){
      const sizes = getScaledSize(img);
      img.width = sizes.width;
      img.height = sizes.height;
      stripHeight += sizes.height;
      imageContainer.appendChild(img);
    }
    log(`loaded ${images.length} images, total ${stripHeight}px`);
    calculateBreaks();
    initSlider(getInitialPins());
  } catch (e) {
    let msg = `Loading error: ${e}`;
    if (e.srcElement) {
      msg = `Error loading ${e.srcElement.dataset["name"]}`;
    }
    log(msg);
    console.error(msg);
    alert(msg);
    return loadImages([]);
  } finally {
    $('#loadingModal').modal('hide');
  }
}

function updateSliceSizes(positions: number[]){
  const ul = document.querySelector('#slice-sizes') as HTMLElement;
  if (positions.length === 0) {
    ul.innerHTML = '<li>(no pages)</li>';
    return;
  }
  const frag = new DocumentFragment();
  let prevPosition = 0;
  const makeDownloader = (y1: number, y2: number, pageNum: number) => {
    return (evt: Event) => {
      const name = sliceName(pageNum);
      downloadSlice(y1, y2, name, downloadBlob);
      evt.preventDefault();
      return false;
    }
  }
  const maxDifference = getWarnDifference();
  for(const [idx, position] of positions.concat(stripHeight).entries()){
    const size = position - prevPosition;
    const li = document.createElement('li');
    const jumpLink = document.createElement('a');
    li.appendChild(jumpLink);
    li.appendChild(document.createTextNode(' '));
    jumpLink.href = '#';
    jumpLink.innerText = `${stripWidth}x${size}`
    jumpLink.addEventListener('click', (evt) => {
      const origins = slider.getElementsByClassName('noUi-origin');
      let origin = origins[idx];
      if(!origin){
        origin = origins[origins.length - 1];
      }
      const absTop = origin.getBoundingClientRect().top + window.pageYOffset;
      const middle = absTop - (window.innerHeight / 2);
      window.scrollTo(0, middle);
      evt.preventDefault();
      return false;
    });
    const diff = Math.abs(size - getPageSize());
    if(diff >= maxDifference){
      li.setAttribute('class', 'bad-size');
    }
    const a = document.createElement('a');
    a.addEventListener('click', makeDownloader(prevPosition, position, idx + 1));
    a.setAttribute('href', '#');
    a.innerText = 'download';
    li.appendChild(a);
    frag.appendChild(li);
    prevPosition = position;
  }
  ul.innerHTML = '';
  ul.appendChild(frag);
}

function getPinPositions(){
  const values = sliderAPI.get();
  if(Array.isArray(values)){
    return values.map((v) => parseFloat(v as string));
  }else{
    return [parseFloat(values as string)];
  }
}

function deletePin(idx: number){
  const positions = getPinPositions();
  positions.splice(idx, 1);
  initSlider(positions);
}

function addPin(newOffset: number){
  const positions = getPinPositions();
  if(newOffset <= 0 || newOffset >= stripHeight){
    return false;
  }
  if(positions.includes(newOffset)){
    return false;
  }
  positions.push(newOffset);
  initSlider(positions);
}

function decorateSliders(){
  const positions = getPinPositions();
  updateSliceSizes(positions);
  let lastPosition = 0;
  for(const [i, tooltip] of Array.from(document.querySelectorAll('div.noUi-tooltip')).entries()){
    const pos = positions[i];
    tooltip.innerHTML = labelFormatter.to(pos);
    const sizeBefore = pos - lastPosition;
    lastPosition = pos;
    let sizeAfter = stripHeight - pos;
    if(i < positions.length - 1){
      sizeAfter = positions[i + 1] - pos;
    }
    const extra = new DocumentFragment();

    // delete pin button
    const removeButton = document.createElement('button');
    removeButton.setAttribute('class', 'delete-pin pin-button');
    extra.appendChild(removeButton);
    removeButton.innerText = '🗑️';

    // do not allow the last one to be deleted
    if(positions.length <= 1){
      removeButton.setAttribute('disabled', 'true');
    }else{
      removeButton.addEventListener('click', () => deletePin(i));
      removeButton.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    // size of segments above and below the ruler
    const beforeDiv = document.createElement('div');
    beforeDiv.setAttribute('class', 'tooltip-before');
    const afterDiv = document.createElement('div');
    afterDiv.setAttribute('class', 'tooltip-after');
    extra.appendChild(beforeDiv);
    extra.appendChild(afterDiv);

    beforeDiv.innerText = labelFormatter.to(sizeBefore);
    afterDiv.innerText = labelFormatter.to(sizeAfter);

    // create add pin buttons
    type Side = {
      parent: HTMLElement;
      offset: number;
    };
    const sides: Side[] = [
      {
        parent: beforeDiv,
        offset: -PIN_STEP,
      },
      {
        parent: afterDiv,
        offset: PIN_STEP,
      }
    ];
    for(const {parent, offset} of sides){
      const addPinButton = document.createElement('button');
      addPinButton.setAttribute('class', 'add-pin pin-button');
      addPinButton.innerText = '➕';
      addPinButton.title = "Add new cut";
      parent.appendChild(addPinButton);
      addPinButton.addEventListener('click', () => addPin(pos + offset));
      addPinButton.addEventListener('mousedown', (e) => e.stopPropagation());

      const moveButton = document.createElement('button');
      moveButton.setAttribute('class', 'move-pin pin-button');
      const direction = parent == beforeDiv ? -1 : 1;
      moveButton.innerText = direction == -1 ? "⏫" : "⏬";
      moveButton.title = "Move to next good cut position";
      parent.appendChild(moveButton);
      moveButton.addEventListener('click', () => {
        console.debug("move pin %o", i);
        const validPositions = goodBreakPositions.filter((v) => Math.sign(v - pos) == direction);
        if (validPositions.length > 0) {
          const posIdx = direction == -1 ? validPositions.length - 1 : 0;
          const newPos = validPositions[posIdx];
          const delta = Math.abs(newPos - pos);

          if (delta > 2 * stripWidth) {
            log("no moving pin: too big jump");
            return;
          }

          console.debug("move pin %o (direction %o) from %o to %o", i, direction, pos, newPos);
          sliderAPI.setHandle(i, validPositions[posIdx], true);
        }
      });
      moveButton.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    tooltip.appendChild(extra);
  }
}

function getNearestBreak(pos: number){
  let before = null;
  for(const y of goodBreakPositions){
    if(y < pos){
      before = y;
    }else if(y == pos){
      return y;
    }else{
      // we are at the break just after the specified position
      if(!before){
        return y;
      }
      const distanceFromLast = (pos - before);
      const distanceToNext = (y - pos);
      if(distanceFromLast <= distanceToNext){
        return before;
      }
      return y;
    }
  }
  return before;
}

function getInitialPins(){
  let pins = [];
  const getNumber = (selector: string) => getInput(selector).valueAsNumber;
  const headerCount = getNumber('#header-count');
  const footerCount = getNumber('#footer-count');
  const pageSize = getPageSize();
  let pos = 0;
  for(const [idx, y] of getImageBreaks().entries()){
    if(idx >= headerCount){
      break;
    }
    pins.push(y);
    pos = y;
  }
  let footerHeight = 0;
  const footerPins = [];
  for(const [idx, y] of getImageBreaks().slice().reverse().entries()){
    if(idx >= footerCount){
      break;
    }
    footerPins.unshift(y);
    footerHeight = stripHeight - y;
  }
  log(`added footer: ${footerPins}, ${footerHeight} px`);

  const warnDiff = getWarnDifference();
  const enableSmartBreaks = getInput('#smart-breaks').checked;
  for(pos += pageSize; pos <= stripHeight - footerHeight; pos += pageSize){
    if(enableSmartBreaks){
      const nearest = getNearestBreak(pos);
      if(nearest && Math.abs(pos - nearest) <= warnDiff){
        pos = nearest;
      }
    }
    pins.push(pos);
  }
  // if the last page is too small, try to merge it with the page before
  if(pins.length > 1){
    log(`pages before merge check: ${JSON.stringify(pins)}`)
    const lastPageHeight = stripHeight - footerHeight - pins[pins.length - 1];
    let secondToLastHeight = pins[pins.length - 1];
    if(pins.length >= 2){
      secondToLastHeight = pins[pins.length - 1] - pins[pins.length - 2];
    }
    if(lastPageHeight < pageSize - warnDiff){
      log(`Last page too small: ${lastPageHeight}, attempting merge with ${secondToLastHeight}`);
      if(secondToLastHeight + lastPageHeight < pageSize + warnDiff){
        pins.pop();
        log('last page merged');
      }
    }
  }
  pins = pins.concat(footerPins);
  return pins;
}

function getImageBreaks(){
  const breaks = [];
  let pos = 0;
  for(const img of images){
    const size = getScaledSize(img);
    pos += size.height;
    breaks.push(pos);
  }
  // we don't want a pin at the end of the strip
  if(breaks.length > 0)
    breaks.pop();
  return breaks;
}

function destroySlider(){
  if(sliderAPI){
    sliderAPI.destroy();
  }
}

function initSlider(pins: number[]){
  if(pins.length == 0){
    pins = [stripHeight];
  }
  pins = pins.sort((a: number, b: number) => a - b);
  destroySlider();
  const tmp = document.getElementById('slider')
  if (tmp)
    slider = tmp;
  else
    throw "Internal error: #slider not found!";
  log(`pins: ${pins}`);

  sliderAPI = noUiSlider.create(slider, {
    start: pins,
    connect: false,
    animate: false,
    tooltips: Array(pins.length).fill(labelFormatter),
    orientation: 'vertical',
    step: 1,
    range: {
      'min': 0,
      'max': stripHeight
    }
  });
  sliderAPI.on('set', decorateSliders);
  decorateSliders();
  // add guide lines to the sliders
  for(const origin of document.querySelectorAll('div.noUi-origin')){
    const ruler = document.createElement('div');
    ruler.setAttribute('class', 'ruler');
    origin.appendChild(ruler);
  }

  $('#pages-tab').tab('show');
}

function renderSlice(y1: number, y2: number){
  const canvas = document.createElement('canvas');
  canvas.width = stripWidth;
  canvas.height = y2 - y1;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw "Error creating canvas context! Try a newer browser!";
  }
  let offset = 0;
  let nextOffset = 0;
  for(const img of images){
    const size = getScaledSize(img);
    offset = nextOffset;
    nextOffset = offset + size.height;
    if(offset + size.height < y1)
      continue;
    if(offset > y2)
      break;
    ctx.drawImage(img, 0, offset - y1, size.width, size.height);
  }
  return canvas.toDataURL('image/png');
}

function dataURLtoBlob(dataURI: string) {
  // convert base64/URLEncoded data component to raw binary data held in a string
  let byteString;
  if (dataURI.split(',')[0].indexOf('base64') >= 0){
    byteString = atob(dataURI.split(',')[1]);
  }else{
    byteString = unescape(dataURI.split(',')[1]);
  }

  // separate out the mime component
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

  // write the bytes of the string to a typed array
  const ia = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ia], {type:mimeString});
}

function downloadBlob(blob: Blob, name: string){
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.dataset.downloadurl = [blob.type, a.download, a.href].join(':');
  const e = document.createEvent('MouseEvents');
  e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
  a.dispatchEvent(e);
  URL.revokeObjectURL(a.href);
}

function downloadDataURL(url: string, name: string){
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  link.click();
}

type DoneCallback = (blob: Blob, name: string) => void;
function downloadSlice(y1: number, y2: number, name: string, downloadFunc: DoneCallback){
  log(`downloadSlice(${y1}, ${y2}, ${name})`);
  const slice = renderSlice(y1, y2)
  const blob = dataURLtoBlob(slice);
  downloadFunc(blob, name);
}

function sliceName(idx: number){
  const prefixInput = getInput('#fn-prefix');
  let prefix = prefixInput.value;
  if(!prefix)
    prefix = DEFAULT_FILENAME_PREFIX;

  return prefix + idx.toString().padStart(2, '0') + '.png';
}

function renderSlices(sliceDoneFunc: DoneCallback, doneFunc?: () => Promise<void>){
  $('#downloadingModal').modal('show');
  setTimeout(async () => {
    const positions = getPinPositions().concat(stripHeight);
    let start = 0;
    let num = 1;
    for(const y of positions){
      if(start == y)
        continue;
      const name = sliceName(num);
      num++;
      downloadSlice(start, y, name, sliceDoneFunc);
      start = y;
    }
    if(doneFunc){
      await doneFunc();
    }
    $('#downloadingModal').modal('hide');
  }, 100);
}

document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('error', (e) => {
    alert(`Unhandled exception:  ${e.error.message}\n\nPlease reload the page!`);
    return false;
  });
  window.addEventListener("unhandledrejection", event => {
    alert(`Unhandled exception:  ${event.reason}\n\nPlease reload the page!`);
    return false;
  });
  imageContainer = document.querySelector('#image-container') as HTMLElement;
  (document.querySelector('#download-button') as HTMLElement).addEventListener('click', () => {
    renderSlices(downloadBlob);
  });
  (document.querySelector('#download-zip-button') as HTMLElement).addEventListener('click', () => {
    const zip = new JSZip();
    const sliceDoneFunc = (blob: Blob, name: string) => zip.file(name, blob);
    const doneFunc = async () => {
      const content = await zip.generateAsync({type: 'blob', compression: 'STORE'});
      downloadBlob(content, 'compiled.zip');
    };
    renderSlices(sliceDoneFunc, doneFunc);
  });
  (document.querySelector('#reset-to-spacing') as HTMLElement).addEventListener('click', (e) => {
    if(stripHeight > 0)
      initSlider(getInitialPins());
    e.preventDefault();
    return false;
  });
  (document.querySelector('#reset-to-breaks') as HTMLElement).addEventListener('click', (e) => {
    if(stripHeight > 0)
      initSlider(getImageBreaks());
    e.preventDefault();
    return false;
  });
  const pageSizeInput = getInput('#page-size-input');
  if(pageSizeInput.validity.valueMissing)
    pageSizeInput.value = '' + DEFAULT_PAGE_SIZE;
  const pageSizeDifferenceInput = getInput('#page-size-difference-input');
  if(pageSizeDifferenceInput.validity.valueMissing)
    pageSizeDifferenceInput.value = '' + DEFAULT_WARN_DIFFERENCE;
  const uploadInput = getInput('#upload-input');
  uploadInput.addEventListener('change', () => {
    if (uploadInput.files)
      loadImages(uploadInput.files);
  });
  loadImages(uploadInput.files || []);
});

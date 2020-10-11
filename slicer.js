const DEFAULT_PAGE_SIZE = 3500;
const DEFAULT_WARN_DIFFERENCE = 1000;
// how many pixels away will we add new pins
const PIN_STEP = 100;
const DEFAULT_FILENAME_PREFIX = 'page_';

var images = [];
var goodBreakPositions = [];
var stripHeight = 0;
var stripWidth = 0;
var imageContainer;
var slider;
var debugLog = "";
const labelFormatter = {to: (num) => Math.floor(num).toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')};

function getPageSize(){
  let input = document.querySelector('#page-size-input');
  if(input.validity.valid){
    return input.valueAsNumber;
  }
  return DEFAULT_PAGE_SIZE;
}

function getWarnDifference(){
  let input = document.querySelector('#page-size-difference-input');
  if(input.validity.valid){
    return input.valueAsNumber;
  }
  return DEFAULT_WARN_DIFFERENCE;
}

function log(value){
  console.log(value);
  debugLog += '\n' + value;
  let elem = document.querySelector('#log');
  elem.innerText = debugLog;
}

function error(value){
  // TODO: the app should be reset to a work-ready state on error
  console.error(value);
  alert(value);
  throw value;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    let img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", err => reject(err));
    img.name = file.name;
    img.src = URL.createObjectURL(file);
  });
};

// find monochromatic lines
function calculateSaliency(){
  goodBreakPositions = [];
  let prevComplex = true;
  let prevColor = [0, 0, 0];
  let y = 0;
  let canvas = document.createElement('canvas');
  const comparePixel = (a, b) => {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  };
  for(const img of images){
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    let ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for(let rowBase = 0; rowBase < data.length; rowBase += stripWidth * 4){
      let complex = false;
      let color = data.slice(rowBase, rowBase+3);
      for(let pos = 4; pos < stripWidth*4; pos += 4){
        let px = data.slice(rowBase+pos, rowBase+pos+3);
        if(!comparePixel(color, px)){
          complex = true;
          break;
        }
      }
      if(complex != prevComplex){
        goodBreakPositions.push(y);
      }else if(!complex && !comparePixel(color, prevColor)){
        goodBreakPositions.push(y);
      }
      prevComplex = complex;
      prevColor = color;
      y++;
    }
  }
}

function loadImages(files){
  imageContainer.innerHTML = '';
  destroySlider();
  for(const img of images){
    URL.revokeObjectURL(img.src);
  }
  images = [];
  let promises = [];
  stripHeight = 0;
  Promise.all(Array.from(files).map(loadImage)).then((newImages) => {
    images = newImages;
    stripHeight = images.reduce((a, b) => a + b.naturalHeight, 0);
    log(`loaded ${images.length} images, total ${stripHeight}px`);
    stripWidth = null;
    for(let img of images){
      imageContainer.appendChild(img);
      if(stripWidth === null){
        stripWidth = img.naturalWidth;
      }else{
        if(img.naturalWidth !== stripWidth){
          error(`Error: image width differs for ${img.name}!`);
        }
      }
    }
    calculateSaliency();
    initSlider(getInitialPins());
    $('#loadingModal').modal('hide');
  }).catch((e) => {
    if(e.srcElement){
      error(`Error loading ${e.srcElement.name}`);
    }else{
      error(`Loading error: ${e}`);
    }
  });
}

function updateSliceSizes(positions){
  let ul = document.querySelector('#slice-sizes');
  let frag = new DocumentFragment();
  let prevPosition = 0;
  let makeDownloader = (y1, y2, pageNum) => {
    return (evt) => {
      let name = sliceName(pageNum);
      downloadSlice(y1, y2, name);
      evt.preventDefault();
      return false;
    }
  }
  const maxDifference = getWarnDifference();
  const pageSize = getPageSize();
  for(const [idx, position] of positions.concat(stripHeight).entries()){
    let size = position - prevPosition;
    let li = document.createElement('li');
    let jumpLink = document.createElement('a');
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
    let diff = Math.abs(size - getPageSize());
    if(diff >= maxDifference){
      li.setAttribute('class', 'bad-size');
    }
    let a = document.createElement('a');
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
  let values = slider.noUiSlider.get();
  if(Array.isArray(values)){
    return values.map(parseFloat);
  }else{
    return [parseFloat(values)];
  }
}

function deletePin(idx){
  let positions = getPinPositions();
  positions.splice(idx, 1);
  initSlider(positions);
}

function addPin(newOffset){
  let positions = getPinPositions();
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
  let positions = getPinPositions();
  updateSliceSizes(positions);
  let lastPosition = 0;
  for(let [i, tooltip] of Array.from(document.querySelectorAll('div.noUi-tooltip')).entries()){
    let pos = positions[i];
    tooltip.innerHTML = labelFormatter.to(pos);
    let sizeBefore = pos - lastPosition;
    lastPosition = pos;
    let sizeAfter = stripHeight - pos;
    if(i < positions.length - 1){
      sizeAfter = positions[i + 1] - pos;
    }
    let extra = new DocumentFragment();

    // delete pin button
    let removeButton = document.createElement('button');
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
    let beforeDiv = document.createElement('div');
    beforeDiv.setAttribute('class', 'tooltip-before');
    let afterDiv = document.createElement('div');
    afterDiv.setAttribute('class', 'tooltip-after');
    extra.appendChild(beforeDiv);
    extra.appendChild(afterDiv);

    beforeDiv.innerText = labelFormatter.to(sizeBefore);
    afterDiv.innerText = labelFormatter.to(sizeAfter);

    // create add pin buttons
    for(const [parent, offset] of [[beforeDiv, -100], [afterDiv, 100]]){
      let addPinButton = document.createElement('button');
      addPinButton.setAttribute('class', 'add-pin pin-button');
      addPinButton.innerText = '+';
      parent.appendChild(addPinButton);
      addPinButton.addEventListener('click', () => addPin(pos + offset));
      addPinButton.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    tooltip.appendChild(extra);
  }
}

function getNearestBreaks(pos){
  let bestBefore = null;
  let val = [];
  for(const y of goodBreakPositions){
    if(y < pos){
      bestBefore = y;
    }else if(y == pos){
      val = [y];
    }else{
      val.push(y);
      break;
    }
  }
  if(bestBefore){
    val.unshift(bestBefore);
  }
  return val;
}

function getInitialPins(){
  let pins = [];
  const headers = document.querySelector('#header-count').valueAsNumber;
  const pageSize = getPageSize();
  let pos = 0;
  for(const [idx, y] of getImageBreaks().entries()){
    if(idx >= headers){
      break;
    }
    pins.push(y);
    pos = y;
  }
  const warnDiff = getWarnDifference();
  const enableSmartBreaks = document.querySelector('#smart-breaks').checked;
  for(pos += pageSize; pos <= stripHeight; pos += pageSize){
    if(enableSmartBreaks){
      let nearestBreaks = getNearestBreaks(pos);
      if(nearestBreaks){
        nearestBreaks.sort((a, b) => {
          return Math.abs(a - pos) - Math.abs(b - pos);
        });
        let nearest = nearestBreaks[0];
        if(Math.abs(pos - nearest) <= warnDiff){
          pos = nearest;
        }
      }
    }
    pins.push(pos);
  }
  return pins;
}

function getImageBreaks(){
  let breaks = [];
  let pos = 0;
  for(const img of images){
    pos += img.naturalHeight;
    breaks.push(pos);
  }
  // we don't want a pin at the end of the strip
  if(breaks.length > 0)
    breaks.pop();
  return breaks;
}

function destroySlider(){
  let sliderObj = null;
  if(slider){
    sliderObj = slider.noUiSlider;
    if(typeof sliderObj !== 'undefined' || sliderObj)
      slider.noUiSlider.destroy();
  }
}

function initSlider(pins){
  if(pins.length == 0){
    pins = [stripHeight];
  }
  pins = pins.sort((a, b) => a - b);
  destroySlider();
  slider = document.getElementById('slider');
  log(`pins: ${pins}`);

  let sliderUI = noUiSlider.create(slider, {
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
  slider.noUiSlider.on('set', decorateSliders);
  decorateSliders();
  // add guide lines to the sliders
  for(let origin of document.querySelectorAll('div.noUi-origin')){
    let ruler = document.createElement('div');
    ruler.setAttribute('class', 'ruler');
    origin.appendChild(ruler);
  }

  $('#pages-tab').tab('show');
}

function renderSlice(y1, y2){
  let canvas = document.createElement('canvas');
  canvas.width = stripWidth;
  canvas.height = y2 - y1;
  let ctx = canvas.getContext('2d');
  let offset = 0;
  let nextOffset = 0;
  for(let img of images){
    offset = nextOffset;
    nextOffset = offset + img.naturalHeight;
    if(offset + img.naturalHeight < y1)
      continue;
    if(offset > y2)
      break;
    ctx.drawImage(img, 0, offset - y1);
  }
  return canvas.toDataURL('image/png');
}

function dataURLtoBlob(dataURI) {
  // convert base64/URLEncoded data component to raw binary data held in a string
  let byteString;
  if (dataURI.split(',')[0].indexOf('base64') >= 0){
    byteString = atob(dataURI.split(',')[1]);
  }else{
    byteString = unescape(dataURI.split(',')[1]);
  }

  // separate out the mime component
  let mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

  // write the bytes of the string to a typed array
  let ia = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ia], {type:mimeString});
}

function downloadBlob(blob, name){
  let a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.dataset.downloadurl = [blob.type, a.download, a.href].join(':');
  let e = document.createEvent('MouseEvents');
  e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
  a.dispatchEvent(e);
  URL.revokeObjectURL(a.href);
}

function downloadDataURL(url, name){
  let link = document.createElement('a');
  link.download = name;
  link.href = url;
  link.click();
}

function downloadSlice(y1, y2, name, downloadFunc){
  log(`downloadSlice(${y1}, ${y2}, ${name})`);
  let slice = renderSlice(y1, y2)
  let blob = dataURLtoBlob(slice);
  downloadFunc(blob, name);
}

function sliceName(idx){
  let prefixInput = document.querySelector('#fn-prefix');
  let prefix = prefixInput.value;
  if(!prefix)
    prefix = DEFAULT_FILENAME_PREFIX;

  return prefix + idx.toString().padStart(2, '0') + '.png';
}

function renderSlices(sliceDoneFunc, doneFunc){
  $('#downloadingModal').modal('show');
  setTimeout(async () => {
    let positions = getPinPositions().concat(stripHeight);
    let start = 0;
    let slices = [];
    let num = 1;
    for(let y of positions){
      let name = sliceName(num);
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
  imageContainer = document.querySelector('#image-container');
  document.querySelector('#download-button').addEventListener('click', () => {
    renderSlices(downloadBlob);
  });
  document.querySelector('#download-zip-button').addEventListener('click', () => {
    let zip = new JSZip();
    let sliceDoneFunc = (blob, name) => zip.file(name, blob);
    let doneFunc = async () => {
      let content = await zip.generateAsync({type: 'blob', compression: 'STORE'});
      downloadBlob(content, 'compiled.zip');
    };
    renderSlices(sliceDoneFunc, doneFunc);
  });
  document.querySelector('#reset-to-spacing').addEventListener('click', (e) => {
    if(stripHeight > 0)
      initSlider(getInitialPins());
    e.preventDefault();
    return false;
  });
  document.querySelector('#reset-to-breaks').addEventListener('click', (e) => {
    if(stripHeight > 0)
      initSlider(getImageBreaks());
    e.preventDefault();
    return false;
  });
  let pageSizeInput = document.querySelector('#page-size-input');
  if(pageSizeInput.validity.valueMissing)
    pageSizeInput.value = DEFAULT_PAGE_SIZE;
  let pageSizeDifferenceInput = document.querySelector('#page-size-difference-input');
  if(pageSizeDifferenceInput.validity.valueMissing)
    pageSizeDifferenceInput.value = DEFAULT_WARN_DIFFERENCE;
  let uploadInput = document.querySelector('#upload-input');
  uploadInput.addEventListener('change', () => {
    $('#loadingModal').modal('show');
    loadImages(uploadInput.files);
  })
});

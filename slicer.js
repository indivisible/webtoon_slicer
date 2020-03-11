const TOO_BIG = 4500;
const TOO_SMALL = 300;
const DEFAULT_PAGE_SIZE = 3500;
// how many pixels away will we add new pins
const PIN_STEP = 100;
const DEFAULT_FILENAME_PREFIX = 'page_';

var images = [];
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

function loadImage(source) {
  return new Promise((resolve, reject) => {
    let img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", err => reject(err));
    img.name = source.name;
    img.src = source.dataURL;
  });
};

function loadImages(urls){
  images = [];
  let promises = [];
  stripHeight = 0;
  Promise.all(Array.from(urls).map(loadImage)).then((newImages) => {
    images = newImages;
    stripHeight = images.reduce((a, b) => a + b.naturalHeight, 0);
    log(`loaded ${images.length} images, total ${stripHeight}px`);
    imageContainer.innerHTML = '';
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
    initSlider(getInitialPins());
    $('#loadingModal').modal('hide');
  }).catch((e) => {
    error(`Error loading ${e.srcElement.name}`);
  });
}

function updateSliceSizes(positions){
  let ul = document.querySelector('#slice-sizes');
  let frag = new DocumentFragment();
  let prevPosition = 0;
  let idx = 0;
  let makeDownloader = (y1, y2, pageNum) => {
    return (e) => {
      let name = sliceName(pageNum);
      downloadSlice(y1, y2, name);
      e.preventDefault();
      return false;
    }
  }
  for(let position of positions.concat(stripHeight)){
    idx++;
    let size = position - prevPosition;
    let li = document.createElement('li');
    li.innerText = `${size}x${stripWidth} `
    if(size < TOO_SMALL || size > TOO_BIG){
      li.setAttribute('class', 'bad-size');
    }
    let a = document.createElement('a');
    a.addEventListener('click', makeDownloader(prevPosition, position, idx));
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
  slider.noUiSlider.destroy();
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
  slider.noUiSlider.destroy();
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

function getInitialPins(){
  let pins = [];
  const pageSize = getPageSize();
  for(let i=pageSize; i<=stripHeight; i+=pageSize){
    pins.push(i);
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

function initSlider(pins){
  if(pins.length == 0){
    pins = [stripHeight];
  }
  pins = pins.sort((a, b) => a - b);
  let sliderObj = null;
  if(slider){
    sliderObj = slider.noUiSlider;
    if(typeof sliderObj !== 'undefined' || sliderObj)
      slider.noUiSlider.destroy();
  }
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
  a.href = window.URL.createObjectURL(blob);
  a.dataset.downloadurl = [blob.type, a.download, a.href].join(':');
  let e = document.createEvent('MouseEvents');
  e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
  a.dispatchEvent(e);
}

function downloadDataURL(url, name){
  let link = document.createElement('a');
  link.download = name;
  link.href = url;
  link.click();
}

function downloadSlice(y1, y2, name){
  log(`downloadSlice(${y1}, ${y2}, ${name})`);
  let slice = renderSlice(y1, y2)
  let blob = dataURLtoBlob(slice);
  downloadBlob(blob, name);
}

function sliceName(idx){
  let prefixInput = document.querySelector('#fn-prefix');
  let prefix = prefixInput.value;
  if(!prefix)
    prefix = DEFAULT_FILENAME_PREFIX;

  return prefix + idx.toString().padStart(2, '0') + '.png';
}

function renderSlices(){
  $('#downloadingModal').modal('show');
  setTimeout(() => {
    let positions = getPinPositions().concat(stripHeight);
    let start = 0;
    let slices = [];
    let num = 1;
    for(let y of positions){
      let name = sliceName(num);
      num++;
      downloadSlice(start, y, name);
      start = y;
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
    renderSlices();
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
  let uploadInput = document.querySelector('#upload-input');
  uploadInput.addEventListener('change', () => {
    $('#loadingModal').modal('show');
    let promises = [];
    for(let file of uploadInput.files){
      promises.push(new Promise((resolve, reject) => {
        let reader = new FileReader();
        let name = file.name;
        reader.addEventListener('load', () => {
          let res = {
            dataURL: reader.result,
            name: name
          }
          resolve(res);
        });
        reader.addEventListener('error', err => reject({error: err, name: name}));
        reader.readAsDataURL(file);
      }));
    }
    Promise.all(promises).then(loadImages).catch((e) => {
      error(`Can't read ${e.name}: ${e.err}`);
    });
  })
});

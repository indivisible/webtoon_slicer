const TOO_BIG = 4500;
const TOO_SMALL = 300;
const IDEAL_SIZE = 3500;
// how many pixels away will we add new pins
const PIN_STEP = 50;
const DEFAULT_FILENAME_PREFIX = 'page_';

var images = [];
var stripHeight = 0;
var stripWidth = 0;
var imageContainer;
var slider;
const labelFormatter = {to: (num) => Math.floor(num).toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')};

function log(value){
  console.log(value);
  let elem = document.querySelector('#log');
  elem.innerText += '\n' + value;
}

function error(value){
  console.error(value);
  alert(value);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    let img = new Image();
    //img.crossOrigin = "anonymous";
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", err => reject(err));
    img.src = src;
  });
};

function loadImages(urls){
  images = [];
  let promises = [];
  stripHeight = 0;
  Promise.all(Array.from(urls).map(loadImage)).then((new_images) => {
    images = new_images;
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
          error(`Error: image width differs for ${img.src}!`);
        }
      }
    }
    initSlider(getInitialPins());
  });
}

function updateSliceSizes(positions){
  let ul = document.querySelector('#slice-sizes');
  let frag = new DocumentFragment();
  let prevPosition = 0;
  let idx = 0;
  let makeDownloader = (y1, y2, name) => {
    return (e) => {
      downloadSlice(y1, y2, name);
      e.preventDefault();
      return false;
    }
  }
  for(let position of positions.concat(stripHeight)){
    idx++;
    let size = position - prevPosition;
    let li = document.createElement('li');
    li.innerText = `Page ${idx}: ${size}x${stripWidth} `
    if(size < TOO_SMALL || size > TOO_BIG){
      li.setAttribute('class', 'bad-size');
    }
    let a = document.createElement('a');
    let filename = sliceName(idx);
    a.addEventListener('click', makeDownloader(prevPosition, position, filename));
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
  log(`addPin(${newOffset})`);
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
    removeButton.setAttribute('class', 'delete-pin');
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
      addPinButton.setAttribute('class', 'add-pin');
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
  for(let i=IDEAL_SIZE; i<=stripHeight; i+=IDEAL_SIZE){
    pins.push(i);
  }
  return pins;
}

function initSlider(pins){
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
}

function renderSlice(y1, y2){
  //log(`renderSlice(${y1}, ${y2})`)
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
    //log(`drawImage(${img}, 0, ${offset - y1})`)
  }
  return canvas.toDataURL('image/png');
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
  downloadDataURL(slice, name);
}

function sliceName(idx){
  let prefixInput = document.querySelector('#fn-prefix');
  let prefix = prefixInput.value;
  if(!prefix)
    prefix = DEFAULT_FILENAME_PREFIX;

  return prefix + idx.toString().padStart(2, '0') + '.png';
}

function renderSlices(){
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
}

document.addEventListener('DOMContentLoaded', () => {
  imageContainer = document.querySelector('#image-container');
  document.querySelector('#download-button').addEventListener('click', () => {
    renderSlices();
  })
  let uploadInput = document.querySelector('#upload-input');
  uploadInput.addEventListener('change', () => {
    let promises = [];
    for(let file of uploadInput.files){
      promises.push(new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result))
        reader.addEventListener('error', err => reject(err))
        reader.readAsDataURL(file);
      }));
    }
    Promise.all(promises).then(loadImages)
  })
});

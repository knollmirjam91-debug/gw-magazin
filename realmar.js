/**
 * @typedef {import('aframe')}
 * @typedef {import('three')}
 */

import "https://cdn.jsdelivr.net/npm/aframe@1.7.0/dist/aframe-master.min.js";
import "https://cdn.jsdelivr.net/npm/aframe-extras@7.5.4/dist/aframe-extras.min.js";
import "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.min.js";
// pako is loaded via script tag in HTML (required by upng-js)
import {
  parseGIF,
  decompressFrames,
} from "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm";
import "https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js";

const AFRAME = window.AFRAME;
const THREE = window.THREE;

// #region composed-texture

// Copyright Mevedia UG - All Rights Reserved
// Author: Fyrestar <info@mevedia.com>
// Release 2

(function (THREE) {
  /* Container, frames can be from any source, their structure is:

	frames
		Either patch or image, if a arraybuffer is provided it will be converted to an Image
		- patch (uncompressed Uint8Array)
		- image (Image element)

		- dims (left, top, width, height)
		- disposalType (number 0-3)
		- delay (number ms)

	*/

  const rev = parseInt(THREE.REVISION);

  const MathUtils = THREE.Math || THREE.MathUtils;
  const Source =
    THREE.Source ||
    function Source(data) {
      this.data = data;
    };

  const Animation = {
    time: 0.0,
    timeScale: 1.0,
    duration: 0.0,
    loop: true,
    auto: true,
    ready: false,
    autoplay: true,
    isPlaying: false,

    seekFrameIndex: function (time) {
      let t = 0.0;

      for (let i = 0, l = this.frames.length; i < l; i++) {
        const frame = this.frames[i];

        if (time >= t && t <= time + frame.delay) return i;

        t += frame.delay;
      }

      return -1;
    },

    pause: function () {
      this.isPlaying = false;

      return this;
    },

    resume: function () {
      this.isPlaying = true;

      return this;
    },

    reset: function () {
      this.time = 0;
      this.frameIndex = 0;
      this.frameTime = 0;

      this.setFrame(this.frameIndex);

      return this;
    },

    play: function () {
      this.time = 0;
      this.frameIndex = 0;
      this.frameTime = 0;
      this.isPlaying = true;

      if (this.auto) {
        const i = THREE.ComposedTexture.index.indexOf(this);
        if (i === -1) THREE.ComposedTexture.index.push(this);
      }

      return this;
    },

    stop: function () {
      this.time = 0;
      this.frameIndex = 0;
      this.frameTime = 0;
      this.isPlaying = false;

      this.setFrame(this.frameIndex);

      if (this.auto) {
        const i = THREE.ComposedTexture.index.indexOf(this);
        if (i > -1) THREE.ComposedTexture.index.splice(i, 1);
      }

      return this;
    },
  };

  function ComposedTexture(
    container,
    mapping,
    wrapS,
    wrapT,
    magFilter,
    minFilter,
    format,
    type,
    anisotropy
  ) {
    this.container = null;
    this.canvas = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas"
    );
    this.ctx = this.canvas.getContext("2d");

    if (container) this.assign(container);

    THREE.CanvasTexture.call(
      this,
      this.canvas,
      mapping,
      wrapS,
      wrapT,
      magFilter,
      minFilter,
      format,
      type,
      anisotropy
    );

    this.version = 0;
  }

  ComposedTexture.auto = true;
  ComposedTexture.autoplay = true;
  ComposedTexture.MaxSpriteSheetResolution = 4096; // May be set by renderer.capabilities.maxTextureSize (recommend default unless needed), sheets going above will be scaled down to it
  ComposedTexture.MaxStripResolution = 2048; // Sprite-sheets below this resolution will be a stripe which is more reasonable for uneven number of frames
  ComposedTexture.copyCanvas = (function () {
    let canvas, ctx;

    return {
      canvas: null,

      dispose: function () {
        this.canvas = canvas = ctx = null;
      },

      dataToImage: async function (data, width, height) {
        if (!canvas) {
          this.canvas = canvas = document.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "canvas"
          );
          ctx = canvas.getContext("2d");
        }

        if (width !== canvas.width || height !== canvas.height) {
          canvas.width = width;
          canvas.height = height;
        }

        const imageData = ctx.getImageData(0, 0, width, height);

        const buffer = imageData.data;

        for (let i = 0, l = buffer.length; i < l; i++) buffer[i] = data[i];

        ctx.putImageData(imageData, 0, 0);

        return new Promise((resolve) => {
          canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);

            const image = new Image();

            image.onload = function () {
              image.onload = null;

              URL.revokeObjectURL(url);

              resolve(image);
            };

            image.src = url;
          }, "image/png");
        });
      },
    };
  })();
  ComposedTexture.index = [];
  ComposedTexture.update = function (delta) {
    for (let texture of this.index) texture.update(delta);
  };

  Object.assign(
    ComposedTexture.prototype,
    THREE.EventDispatcher.prototype,
    THREE.Texture.prototype,
    THREE.CanvasTexture.prototype,
    {
      isCanvasTexture: true,
      isComposedTexture: true,

      constructor: ComposedTexture,

      frameTime: 0,
      frameIndex: 0,
      framePreviousIndex: -1,
      disposalType: 0,
      progressive: false,

      ...Animation,

      autoplay: ComposedTexture.autoplay,

      dispose: function () {
        this.ready = false;
        this.container = this.ctx = this.canvas = null;

        if (this.auto) {
          const i = THREE.ComposedTexture.index.indexOf(this);
          if (i > -1) THREE.ComposedTexture.index.splice(i, 1);
        }

        this.dispatchEvent({ type: "dispose" });
      },

      update: function (delta) {
        if (this.isPlaying) {
          const container = this.container;

          const frame = container.frames[this.frameIndex];

          const t = delta * 1000 * this.timeScale;

          this.frameTime += t;
          this.time = Math.min(this.duration, this.time + t);

          if (this.frameTime >= frame.delay) {
            this.frameTime = 0;

            if (this.frameIndex < container.frames.length - 1) {
              this.frameIndex++;
            } else {
              if (this.loop) {
                this.time = 0;
                this.frameIndex = 0;
              } else {
                this.pause();
              }
            }

            this.compose(this.frameIndex);
          }
        }
      },

      assign: async function (container) {
        this.stop();

        this.auto =
          container.auto !== undefined ? container.auto : ComposedTexture.auto;
        this.duration = 0;
        this.frameIndex = 0;
        this.framePreviousIndex = -1;
        this.disposalType = 0;
        this.progressive = true;
        this.ready = false;
        this.autoplay =
          container.autoplay !== undefined ? container.autoplay : this.autoplay;

        // Auto playback for all textures

        if (this.auto && ComposedTexture.index.indexOf(this) == -1)
          ComposedTexture.index.push(this);

        let { width, height } = container;

        const powerOfTwo = container.downscale
          ? MathUtils.floorPowerOfTwo
          : MathUtils.ceilPowerOfTwo;

        if (!MathUtils.isPowerOfTwo(container.width))
          width = powerOfTwo(container.width);

        if (!MathUtils.isPowerOfTwo(container.height))
          height = powerOfTwo(container.height);

        this.canvas.width = width;
        this.canvas.height = height;

        this.container = container;

        // Process frames

        for (let frame of container.frames) {
          this.duration += frame.delay;

          if (frame.disposalType > 1) this.progressive = false;

          if (!frame.image)
            frame.image = await ComposedTexture.copyCanvas.dataToImage(
              frame.patch,
              frame.dims.width,
              frame.dims.height
            );
        }

        this.ready = true;

        this.dispatchEvent({ type: "ready" });

        if (this.autoplay) this.play();
      },

      setFrame: function (index) {
        this.compose(index);
      },

      // Vertical only relevant if a stripe is used
      // maxResolution - ensures to not generate a texture larger than this, frames will be scaled down to fit
      // maxStripSize - if frames stacked are larger than this, an atlas layout is used instead a strip

      toSheet: async function (
        padding = 0,
        vertical = false,
        maxResolution = ComposedTexture.MaxSpriteSheetResolution,
        maxStripResolution = ComposedTexture.MaxStripResolution
      ) {
        const { container } = this;

        let { width, height } = this.canvas;

        const srcWidth = width;
        const srcHeight = height;

        const frameCount = container.frames.length;

        const canvas = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas"
        );

        // Layout - either use stripes or atlas layout
        // Atlas on even frame count or if stripde exceeds optimal texture size, however, uneven frames means there can be unsed slots

        let asAtlas =
          frameCount % 2 === 0 ||
          Math.max(
            frameCount * width + frameCount * padding,
            frameCount * height + frameCount * padding
          ) > maxStripResolution;

        const layout = vertical ? [1, frameCount] : [frameCount, 1];

        if (asAtlas) {
          const columns = Math.floor(maxStripResolution / width);
          const rows = Math.ceil(frameCount / columns);

          layout[0] = columns;
          layout[1] = rows;
        }

        // Prevent unreasonable large texture likely not supported by most GPU or any

        let atlasWidth = layout[0] * width + layout[0] * padding;
        let atlasHeight = layout[1] * height + layout[1] * padding;
        let scale = 1.0;

        if (Math.max(atlasWidth, atlasHeight) > maxResolution) {
          scale = maxResolution / Math.max(atlasWidth, atlasHeight);

          atlasWidth = Math.ceil(atlasWidth * scale);
          atlasHeight = Math.ceil(atlasHeight * scale);
        }

        width = Math.floor(width * scale);
        height = Math.floor(height * scale);

        padding = Math.floor(padding * scale); // May degenerate if small and scaled down due maxResolution exceeded as above

        canvas.width = atlasWidth;
        canvas.height = atlasHeight;

        const frames = [];

        const image = new Image();
        const texture = new THREE.Texture();

        texture.needsUpdate = true;

        const source = new Source(image);
        source.needsUpdate = true;

        const frameWidth = width - padding;
        const frameHeight = height - padding;

        const sheet = {
          texture,
          source,
          tileWidth: width,
          tileHeight: height,
          frameWidth,
          frameHeight,
          atlasWidth,
          atlasHeight,
          autoplay: this.autoplay,
          duration: this.duration,
          padding,
          frames,
          layout,
        };

        // Compose sheet

        let ctx = canvas.getContext("2d");

        let x = 0,
          y = 0,
          // row = 0,
          column = 0;

        for (let i = 0; i < frameCount; i++) {
          const frame = container.frames[i];

          this.compose(i);

          ctx.drawImage(
            this.canvas,
            0,
            0,
            srcWidth,
            srcHeight,
            x,
            y,
            frameWidth,
            frameHeight
          );

          frames.push({
            left: x,
            top: y,
            delay: frame.delay,
          });

          if (asAtlas) {
            x += width;

            column++;

            if (column === layout[0]) {
              x = 0;
              y += height;
              // row++;
              column = 0;
            }
          } else {
            vertical ? (y += height) : (x += width);
          }
        }

        ctx = null;

        return new Promise((resolve) => {
          canvas.toBlob(function (blob) {
            image.onload = function () {
              this.onload = null;

              sheet.texture.image = this; // Somehow the Image handle changes

              URL.revokeObjectURL(this.src);

              resolve(sheet);
            };

            image.src = URL.createObjectURL(blob);
          }, "image/png");
        });
      },

      compose: function (frameIndex) {
        if (this.ready) {
          this.frameIndex = frameIndex;

          if (
            this.progressive &&
            (this.framePreviousIndex > frameIndex ||
              this.framePreviousIndex + 1 < frameIndex)
          ) {
            // Needs to re-compose missing frames

            this.ctx.clearRect(0, 0, this.width, this.height);

            for (let i = 0; i <= frameIndex; i++) this._render(i);
          } else if (frameIndex !== this.framePreviousIndex) {
            this._render(frameIndex);
          }

          this.framePreviousIndex = frameIndex;
        } else if (this.idleRender instanceof Function) {
          this.idleRender(this.ctx);
        }
      },

      _render: function (frameIndex) {
        if (frameIndex === 0) this.frameRestoreIndex = -1;

        const { ctx, container, canvas, disposalType } = this;

        const currentFrame = container.frames[frameIndex];
        const dims = currentFrame.dims;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(
          canvas.width / container.width,
          canvas.height / container.height
        );

        if (frameIndex > 0) {
          if (disposalType === 3) {
            // Restore to previous

            if (this.frameRestoreIndex > -1) {
              const restoreFrame = container.frames[this.frameRestoreIndex];
              const dims = restoreFrame.dims;

              if (restoreFrame.blend === 0)
                ctx.clearRect(dims.left, dims.top, dims.width, dims.height);

              ctx.drawImage(
                restoreFrame.image,
                dims.left,
                dims.top,
                dims.width,
                dims.height
              );
            } else {
              // Nothing to restore, clear

              ctx.clearRect(dims.left, dims.top, dims.width, dims.height);
            }
          } else {
            this.frameRestoreIndex = Math.max(frameIndex - 1, 0);
          }

          if (disposalType === 2 && this.frameRestoreIndex > -1) {
            const restoreFrame = container.frames[this.frameRestoreIndex];
            const dims = restoreFrame.dims;

            ctx.clearRect(dims.left, dims.top, dims.width, dims.height);
          }
        }

        if (currentFrame.blend === 0)
          ctx.clearRect(dims.left, dims.top, dims.width, dims.height);

        ctx.drawImage(
          currentFrame.image,
          dims.left,
          dims.top,
          dims.width,
          dims.height
        );

        this.disposalType = currentFrame.disposalType;

        // Flag texture for upload

        this.needsUpdate = true;
        this.version++;
      },
    }
  );

  /* SpriteTexture
	  
	  SpriteTexture uses a sprite-sheet for the displayed frame of the shared spritesheet texture. The texture
	  is only shared since THREE release 138+, since "source" on THREE.Texture is available, otherwise texture per Sprite is used.

	  You may load a ready baked sprite-sheet as well, providing this information.
	  
	  sheet
		- source THREE.Source
		- atlasWidth
		- altasHeight
		- width - frame width ( without padding )
		- height - frame height ( without padding )
		- frameWidth
		- frameHeight
		- frames ( optional )
			- left
			- top
			- delay

		If frames are not provided you can let it define by providing 'rows' and 'columns' as well as 'duration'
		- duration
		- rows
		- columns
		
	 */

  function SpriteTexture(sheet) {
    this.sheet = null;
    this.currentFrame = null;

    THREE.Texture.call(this);

    if (sheet) this.assign(sheet);
  }

  Object.assign(
    SpriteTexture.prototype,
    THREE.EventDispatcher.prototype,
    THREE.Texture.prototype,
    {
      ...Animation,

      autoplay: ComposedTexture.autoplay,

      dispose: function () {
        this.ready = false;

        if (this.auto) {
          const i = THREE.ComposedTexture.index.indexOf(this);
          if (i > -1) THREE.ComposedTexture.index.splice(i, 1);
        }

        this.dispatchEvent({ type: "dispose" });
      },

      copy: function (source) {
        THREE.Texture.prototype.copy.call(this, source);

        this.sheet = source.sheet;
        this.reset();
      },

      setFrame: function (index) {
        const frame = this.sheet.frames[index];

        if (frame) {
          this.time = frame.time;
          this.frameIndex = index;

          this.compose(index);
        }
      },

      assign: function (sheet) {
        this.sheet = sheet;
        this.auto = sheet.auto !== undefined ? sheet.auto : true;
        this.autoplay =
          sheet.autoplay !== undefined
            ? sheet.autoplay
            : ComposedTexture.autoplay;

        // Get frames if not given ( texture, count, columns and duration or delay in ms needs to be provided )

        if (!sheet.frames && sheet.texture && sheet.count && sheet.columns) {
          sheet.rows = Math.ceil(sheet.count / sheet.columns);
          sheet.atlasWidth = sheet.texture.image.width;
          sheet.atlasHeight = sheet.texture.image.height;
          sheet.padding = sheet.padding !== undefined ? sheet.padding : 0;

          sheet.tileWidth = sheet.atlasWidth / sheet.columns;
          sheet.tileHeight = sheet.atlasHeight / sheet.rows;

          sheet.frameWidth = sheet.tileWidth - sheet.padding;
          sheet.frameHeight = sheet.tileHeight - sheet.padding;

          sheet.frames = [];

          const count = sheet.rows * sheet.columns;
          const delay = sheet.duration
            ? sheet.duration / count
            : sheet.delay
              ? sheet.delay
              : 8;

          let c = 0;

          for (let y = 0, l = sheet.rows; y < l; y++)
            for (let x = 0, l = sheet.columns; x < l; x++) {
              sheet.frames.push({
                left: x * sheet.tileWidth,
                top: y * sheet.tileHeight,
                delay,
              });

              c++;
              if (c === sheet.count) break;
            }
        }

        // Get total duration if not defined

        if (!sheet.duration) {
          let duration = 0;

          for (let frame of sheet.frames) duration += frame.delay;

          sheet.duration = duration;
        }

        // Share original spritesheet texture on GPU

        if (sheet.source && rev >= 138) {
          // Requires R38+

          this.ource = sheet.source;
          this.needsUpdate = true;
        } else {
          // Fallback

          this.image = sheet.texture.image;
          this.needsUpdate = true;

          if (rev <= 126) this.version++;
        }

        // Auto playback for all textures

        if (this.auto && THREE.ComposedTexture.index.indexOf(this) == -1)
          THREE.ComposedTexture.index.push(this);

        this.duration = sheet.duration;
        this.ready = true;

        this.compose(0);

        if (this.autoplay) this.play();
      },

      update: function (delta) {
        if (this.isPlaying) {
          const { sheet } = this;

          const frame = sheet.frames[this.frameIndex];

          const t = delta * 1000 * this.timeScale;

          this.frameTime += t;
          this.time = Math.min(this.duration, this.time + t);

          if (this.frameTime >= frame.delay) {
            this.frameTime = 0;

            if (this.frameIndex < sheet.frames.length - 1) {
              this.frameIndex++;
            } else {
              if (this.loop) {
                this.time = 0;
                this.frameIndex = 0;
              } else {
                this.pause();
              }
            }

            this.compose(this.frameIndex);
          }
        }
      },

      compose: function (frameIndex) {
        const frame = this.sheet.frames[frameIndex];

        if (frame) {
          const sheet = this.sheet;

          this.frameIndex = frameIndex;
          this.currentFrame = frame;

          // Frame texture transform update ( using human readable coordinates for universal use )

          this.offset.set(
            frame.left / sheet.atlasWidth,
            1.0 - (frame.top + sheet.tileHeight) / sheet.atlasHeight
          );
          this.repeat.set(
            sheet.tileWidth / sheet.atlasWidth,
            sheet.tileHeight / sheet.atlasHeight
          );
          this.updateMatrix();
        }
      },
    }
  );

  THREE.ComposedTexture = ComposedTexture;
  THREE.SpriteTexture = SpriteTexture;

  // ES6 class fix

  if (rev > 126) {
    class ComposedTexture extends THREE.CanvasTexture {
      constructor(
        container,
        mapping,
        wrapS,
        wrapT,
        magFilter,
        minFilter,
        format,
        type,
        anisotropy
      ) {
        const canvas = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas"
        );
        const ctx = canvas.getContext("2d");

        super(
          canvas,
          mapping,
          wrapS,
          wrapT,
          magFilter,
          minFilter,
          format,
          type,
          anisotropy
        );

        this.container = null;
        this.canvas = canvas;
        this.ctx = ctx;
        this.version = 0;

        if (container) this.assign(container);
      }
    }

    Object.assign(ComposedTexture, THREE.ComposedTexture);
    Object.assign(ComposedTexture.prototype, THREE.ComposedTexture.prototype);

    THREE.ComposedTexture = ComposedTexture;

    class SpriteTexture extends THREE.Texture {
      constructor(
        sheet,
        mapping,
        wrapS,
        wrapT,
        magFilter,
        minFilter,
        format,
        type,
        anisotropy
      ) {
        super(
          sheet ? sheet.texture.image : null,
          mapping,
          wrapS,
          wrapT,
          magFilter,
          minFilter,
          format,
          type,
          anisotropy
        );

        this.sheet = null;
        this.currentFrame = null;

        if (sheet) this.assign(sheet);
      }
    }

    Object.assign(SpriteTexture, THREE.SpriteTexture);
    Object.assign(SpriteTexture.prototype, THREE.SpriteTexture.prototype);

    THREE.SpriteTexture = SpriteTexture;
  }
})(window.THREE);

// #endregion composed-texture

// #region look-at

AFRAME.registerComponent("look-at", {
  schema: { type: "selector" },

  init: function () {},

  tick: function () {
    // TODO: fix look-at
    // this.el.object3D.lookAt(this.data.object3D.position);
  },
});

// #region quaternion

AFRAME.registerComponent("quaternion", {
  schema: { type: "vec4" },

  update: function () {
    const data = this.data;
    const object3D = this.el.object3D;
    object3D.quaternion.set(data.x, data.y, data.z, data.w);
  },

  remove: function () {
    this.el.object3D.quaternion.set(0, 0, 0, 1);
  },
});

// #region text-3d

/**
 * TextGeometry from three-stdlib
 */
/**
 * TextGeometry creates 3D text geometry by extending THREE.ExtrudeGeometry
 * @extends THREE.ExtrudeGeometry
 */
class TextGeometry extends THREE.ExtrudeGeometry {
  /**
   * Creates a new text geometry
   * @param {string} text - The text to be rendered as 3D geometry
   * @param {Object} [parameters={}] - Configuration options
   * @param {boolean} [parameters.bevelEnabled=false] - Whether to use beveling
   * @param {number} [parameters.bevelSize=8] - Size of the bevel
   * @param {number} [parameters.bevelThickness=10] - Thickness of the bevel
   * @param {Object} [parameters.font] - Font object used to generate text shapes
   * @param {number} [parameters.height=50] - Height/extrusion depth of the text
   * @param {number} [parameters.size=100] - Font size
   * @param {number} [parameters.lineHeight=1] - Line height factor
   * @param {number} [parameters.letterSpacing=0] - Spacing between letters
   */
  constructor(text, parameters = {}) {
    const {
      bevelEnabled = false,
      bevelSize = 8,
      bevelThickness = 10,
      font,
      height = 50,
      size = 100,
      lineHeight = 1,
      letterSpacing = 0,
      ...rest
    } = parameters;
    if (font === void 0) {
      super();
    } else {
      const shapes = font.generateShapes(text, size, {
        lineHeight,
        letterSpacing,
      });
      super(shapes, {
        ...rest,
        bevelEnabled,
        bevelSize,
        bevelThickness,
        depth: height,
      });
    }
    this.type = "TextGeometry";
  }
}

export class FontLoader extends THREE.Loader {
  constructor(manager) {
    super(manager);
  }

  load(url, onLoad, onProgress, onError) {
    const loader = new THREE.FileLoader(this.manager);

    loader.setPath(this.path);
    loader.setRequestHeader(this.requestHeader);
    loader.setWithCredentials(this.withCredentials);

    loader.load(
      url,
      (response) => {
        if (typeof response !== "string")
          throw new Error("unsupported data type");

        const json = JSON.parse(response);

        const font = this.parse(json);

        if (onLoad) onLoad(font);
      },
      onProgress,
      onError
    );
  }

  loadAsync(url, onProgress) {
    return super.loadAsync(url, onProgress);
  }

  parse(json) {
    return new Font(json);
  }
}

export class Font {
  isFont = true;
  type = "Font";

  constructor(data) {
    this.data = data;
  }

  generateShapes(text, size = 100, _options) {
    const shapes = [];
    const options = { letterSpacing: 0, lineHeight: 1, ..._options };
    const paths = createPaths(text, size, this.data, options);
    for (let p = 0, pl = paths.length; p < pl; p++) {
      Array.prototype.push.apply(shapes, paths[p].toShapes(false));
    }
    return shapes;
  }
}

function createPaths(text, size, data, options) {
  const chars = Array.from(text);
  const scale = size / data.resolution;
  const line_height =
    (data.boundingBox.yMax - data.boundingBox.yMin + data.underlineThickness) *
    scale;

  const paths = [];

  let offsetX = 0,
    offsetY = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];

    if (char === "\n") {
      offsetX = 0;
      offsetY -= line_height * options.lineHeight;
    } else {
      const ret = createPath(char, scale, offsetX, offsetY, data);
      if (ret) {
        offsetX += ret.offsetX + options.letterSpacing;
        paths.push(ret.path);
      }
    }
  }

  return paths;
}

function createPath(char, scale, offsetX, offsetY, data) {
  const glyph = data.glyphs[char] || data.glyphs["?"];

  if (!glyph) {
    console.error(
      'THREE.Font: character "' +
        char +
        '" does not exists in font family ' +
        data.familyName +
        "."
    );
    return;
  }

  const path = new THREE.ShapePath();

  let x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2;

  if (glyph.o) {
    const outline =
      glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(" "));

    for (let i = 0, l = outline.length; i < l; ) {
      const action = outline[i++];

      switch (action) {
        case "m": // moveTo
          x = parseInt(outline[i++]) * scale + offsetX;
          y = parseInt(outline[i++]) * scale + offsetY;

          path.moveTo(x, y);

          break;

        case "l": // lineTo
          x = parseInt(outline[i++]) * scale + offsetX;
          y = parseInt(outline[i++]) * scale + offsetY;

          path.lineTo(x, y);

          break;

        case "q": // quadraticCurveTo
          cpx = parseInt(outline[i++]) * scale + offsetX;
          cpy = parseInt(outline[i++]) * scale + offsetY;
          cpx1 = parseInt(outline[i++]) * scale + offsetX;
          cpy1 = parseInt(outline[i++]) * scale + offsetY;

          path.quadraticCurveTo(cpx1, cpy1, cpx, cpy);

          break;

        case "b": // bezierCurveTo
          cpx = parseInt(outline[i++]) * scale + offsetX;
          cpy = parseInt(outline[i++]) * scale + offsetY;
          cpx1 = parseInt(outline[i++]) * scale + offsetX;
          cpy1 = parseInt(outline[i++]) * scale + offsetY;
          cpx2 = parseInt(outline[i++]) * scale + offsetX;
          cpy2 = parseInt(outline[i++]) * scale + offsetY;

          path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy);

          break;
      }
    }
  }

  return { offsetX: glyph.ha * scale, path };
}

/**
 * @typedef {Object} Text3DData
 * @property {string} text
 * @property {string} font
 * @property {number} size
 * @property {number} height
 * @property {number} curveSegments
 * @property {boolean} bevelEnabled
 * @property {number} bevelThickness
 * @property {number} bevelSize
 * @property {number} bevelOffset
 * @property {number} bevelSegments
 * @property {string} material
 * @property {string|number} color
 * @property {number} lineHeight
 * @property {number} letterSpacing
 */

/**
 * Creates 3D text geometry using THREE.TextGeometry.
 * Requires THREE.FontLoader and THREE.TextGeometry to be available.
 * Make sure your A-Frame build includes these or load Three.js separately.
 *
 * @this {AFRAME.Component & {data: Text3DData}}
 */
AFRAME.registerComponent("text-3d", {
  schema: {
    text: { type: "string", default: "Hello three.js!" },
    font: {
      type: "string",
      default:
        "https://cdn.jsdelivr.net/npm/three@0.163.0/examples/fonts/helvetiker_regular.typeface.json",
    }, // Path to Three.js font JSON file
    size: { type: "number", default: 1 }, // Corresponds to TextGeometry 'size', adjusted default for A-Frame scale
    height: { type: "number", default: 0.1 }, // Corresponds to TextGeometry 'height', adjusted default
    curveSegments: { type: "int", default: 12 },
    bevelEnabled: { type: "boolean", default: false },
    bevelThickness: { type: "number", default: 0.1 }, // Adjusted default
    bevelSize: { type: "number", default: 0.05 }, // Adjusted default
    bevelOffset: { type: "number", default: 0 },
    bevelSegments: { type: "int", default: 3 },
    material: { type: "string", default: "" }, // Optional: reference existing material component
    color: { type: "color", default: "#FFF" }, // Default color if no material specified
    lineHeight: { type: "number", default: 1 }, // Line height factor
    letterSpacing: { type: "number", default: 0 }, // Spacing between letters
  },
  init: function () {
    this.loader = new FontLoader();
    this.font = null;
    this.geometry = null;
    this.mesh = null;
    this.material = null;

    this.loadFont();
  },

  /**
   * @param {Text3DData} oldData
   */
  update: function (oldData) {
    /** @type {Text3DData} */
    const data = this.data;
    let needsUpdate = false;
    let needsFontReload = false;

    // Check if font needs reloading
    if (oldData && data.font !== oldData.font) {
      needsFontReload = true;
    }

    // Check if geometry needs rebuilding
    for (const key in data) {
      if (
        key !== "font" &&
        key !== "material" &&
        key !== "color" &&
        oldData &&
        data[key] !== oldData[key]
      ) {
        needsUpdate = true;
        break;
      }
    }

    // Check if material needs update
    if (
      oldData &&
      (data.material !== oldData.material || data.color !== oldData.color)
    ) {
      needsUpdate = true; // Need to update mesh material reference or color
    }

    if (needsFontReload) {
      this.loadFont(); // This will trigger createTextGeometry eventually
    } else if (needsUpdate && this.font) {
      this.createTextGeometry(); // Rebuild geometry or update material
    } else if (!this.mesh && this.font) {
      // Initial creation after font load
      this.createTextGeometry();
    }
  },

  loadFont: function () {
    this.loader.load(
      this.data.font,
      (font) => {
        this.font = font;
        this.createTextGeometry();
      },
      undefined,
      (err) => {
        console.error("Could not load font: ", err);
      }
    );
  },

  createTextGeometry: function () {
    /** @type {Text3DData} */
    const data = this.data;

    // Dispose old geometry if it exists
    if (this.geometry) {
      this.geometry.dispose();
    }

    // Create new geometry
    this.geometry = new TextGeometry(data.text, {
      font: this.font,
      size: data.size,
      height: data.height,
      curveSegments: data.curveSegments,
      bevelEnabled: data.bevelEnabled,
      bevelThickness: data.bevelThickness,
      bevelSize: data.bevelSize,
      bevelOffset: data.bevelOffset,
      bevelSegments: data.bevelSegments,
      lineHeight: data.lineHeight,
      letterSpacing: data.letterSpacing,
    });

    // Center the geometry
    this.geometry.computeBoundingBox();

    const box = this.geometry.boundingBox;

    if (box) {
      const center = box.getCenter(new THREE.Vector3());
      // Calculate the offset needed to move the center to the origin
      const offset = center.clone().negate();

      // Apply the offset to the geometry
      this.geometry.translate(offset.x, offset.y, offset.z);
    }

    // Material handling
    let materialComponent = null;
    if (data.material && this.el.sceneEl.systems.material) {
      materialComponent =
        this.el.sceneEl.systems.material.materials[data.material];
    }

    if (materialComponent) {
      this.material = materialComponent;
    } else {
      // Dispose old internally managed material
      if (this.mesh && this.mesh.material && !this.mesh.material.isShared) {
        this.mesh.material.dispose();
      }
      // Create new lambert material if no external one is provided
      this.material = new THREE.MeshLambertMaterial({ color: data.color });
      this.material.isShared = false; // Mark as not shared
    }

    // Create or update mesh
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.el.setObject3D("mesh", this.mesh);
    } else {
      this.mesh.geometry = this.geometry;
      this.mesh.material = this.material;
    }
  },

  remove: function () {
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    // Only dispose internally managed material
    if (this.mesh && this.mesh.material && !this.mesh.material.isShared) {
      this.mesh.material.dispose();
    }
    if (this.mesh) {
      this.el.removeObject3D("mesh");
      this.mesh = null;
    }
    this.font = null;
    this.loader = null;
  },
});

// #endregion text-3d

// #region mindar-image-target

// delete AFRAME.components["mindar-image-system"] to override the default from mind-ar
// delete AFRAME.components["mindar-image-target"];

// AFRAME.registerComponent("mindar-image-target", {
//   dependencies: ["mindar-image-system"],

//   schema: {
//     targetIndex: { type: "number" },
//   },

//   postMatrix: null, // rescale the anchor to make width of 1 unit = physical width of card

//   init: function () {
//     const arSystem = this.el.sceneEl.systems["mindar-image-system"];
//     arSystem.registerAnchor(this, this.data.targetIndex);

//     this.invisibleMatrix = new AFRAME.THREE.Matrix4().set(
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0,
//       0
//     );

//     this.el.object3D.matrixAutoUpdate = false;

//     this._hide();
//   },

//   _hide: function () {
//     const root = this.el.object3D;
//     root.visible = false;
//     root.matrix = this.invisibleMatrix;
//   },

//   setupMarker([markerWidth, markerHeight]) {
//     const position = new AFRAME.THREE.Vector3();
//     const quaternion = new AFRAME.THREE.Quaternion();
//     const scale = new AFRAME.THREE.Vector3();
//     position.x = markerWidth / 2;
//     position.y = markerWidth / 2 + (markerHeight - markerWidth) / 2;
//     scale.x = markerWidth;
//     scale.y = markerWidth;
//     scale.z = markerWidth;
//     this.postMatrix = new AFRAME.THREE.Matrix4();
//     this.postMatrix.compose(position, quaternion, scale);
//   },

//   updateWorldMatrix(worldMatrix) {
//     const hiddenByDependsOn =
//       this.el.hasAttribute("realmar-depends-on") &&
//       !this.el.components["realmar-depends-on"].didFindDependency;
//     if (hiddenByDependsOn) {
//       console.warn("Not showing target due to realmar-depends-on");
//       worldMatrix = null;
//     }

//     this.el.emit("targetUpdate");
//     if (!this.el.object3D.visible && worldMatrix !== null) {
//       this.el.emit("targetFound");
//     } else if (this.el.object3D.visible && worldMatrix === null) {
//       this.el.emit("targetLost");
//     }

//     this.el.object3D.visible = worldMatrix !== null;
//     if (worldMatrix === null) {
//       this.el.object3D.matrix = this.invisibleMatrix;
//       return;
//     }
//     var m = new AFRAME.THREE.Matrix4();
//     m.elements = worldMatrix;
//     m.multiply(this.postMatrix);
//     this.el.object3D.matrix = m;
//   },
// });

const originalUpdateWorldMatrix =
  AFRAME.components["mindar-image-target"].updateWorldMatrix;

AFRAME.components["mindar-image-target"].updateWorldMatrix = function (
  worldMatrix
) {
  const hiddenByDependsOn =
    this.el.hasAttribute("realmar-depends-on") &&
    !this.el.components["realmar-depends-on"].didFindDependency;
  if (hiddenByDependsOn) {
    console.warn("Not showing target due to realmar-depends-on");
    worldMatrix = null;
  }
  originalUpdateWorldMatrix.call(this, worldMatrix);
};
// #endregion mindar-image-target

// #region float

/**
 * @typedef {Object} FloatData
 * @property {boolean} enabled - Whether the floating effect is active
 * @property {number} speed - Speed of the floating animation
 * @property {number} rotationIntensity - Intensity of rotation effect
 * @property {number} intensity - Intensity of vertical floating motion
 * @property {number} floatingRangeMin - Minimum value for the float range
 * @property {number} floatingRangeMax - Maximum value for the float range
 * @property {boolean} autoInvalidate - Whether to force updates on materials
 */

/**
 * Adds a gentle floating animation to an entity.
 * Creates smooth oscillating movement and rotation similar to drei's Float component.
 *
 * @this {AFRAME.Component & {data: FloatData}}
 */
AFRAME.registerComponent("float", {
  schema: {
    enabled: { type: "boolean", default: true },
    speed: { type: "number", default: 1 },
    rotationIntensity: { type: "number", default: 1 },
    intensity: { type: "number", default: 1 },
    floatingRangeMin: { type: "number", default: -0.1 },
    floatingRangeMax: { type: "number", default: 0.1 },
    autoInvalidate: { type: "boolean", default: false },
  },

  init: function () {
    // Random offset like in the original component
    this.offset = Math.random() * 10000;

    // Store original values
    this.originalY = this.el.object3D.position.y || 0;

    // Store original matrix auto update setting
    this.wasMatrixAutoUpdate = this.el.object3D.matrixAutoUpdate;

    // Disable automatic matrix updates for performance
    this.el.object3D.matrixAutoUpdate = false;
  },

  tick: function (time) {
    /** @type {FloatData} */
    const data = this.data;

    if (!data.enabled || data.speed === 0) return;

    const t = this.offset + time / 1000; // Convert ms to seconds like THREE.Clock.elapsedTime
    const speed = data.speed;
    const rotationIntensity = data.rotationIntensity;

    // Apply rotations
    this.el.object3D.rotation.x =
      (Math.cos((t / 4) * speed) / 8) * rotationIntensity;
    this.el.object3D.rotation.y =
      (Math.sin((t / 4) * speed) / 8) * rotationIntensity;
    this.el.object3D.rotation.z =
      (Math.sin((t / 4) * speed) / 20) * rotationIntensity;

    // Apply floating motion
    let yPosition = Math.sin((t / 4) * speed) / 10;
    // Map to custom range (similar to THREE.MathUtils.mapLinear)
    yPosition = THREE.MathUtils.mapLinear(
      yPosition,
      -0.1,
      0.1,
      data.floatingRangeMin,
      data.floatingRangeMax
    );

    // Apply position
    this.el.object3D.position.y = this.originalY + yPosition * data.intensity;

    // Manually update the matrix
    this.el.object3D.updateMatrix();

    // Force scene render if autoInvalidate is true
    if (data.autoInvalidate) {
      this.el.object3D.traverse((node) => {
        if (node.material) node.material.needsUpdate = true;
      });
    }
  },

  // Utility function to replicate THREE.MathUtils.mapLinear
  // mapLinear: function (x, a1, a2, b1, b2) {
  //   return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
  // },

  remove: function () {
    // Reset position and rotation
    this.el.object3D.position.y = this.originalY;
    this.el.object3D.rotation.set(0, 0, 0);

    // Restore original matrix auto update setting
    this.el.object3D.matrixAutoUpdate = this.wasMatrixAutoUpdate;

    // Make sure to update the matrix one last time
    this.el.object3D.updateMatrix();
  },
});

// #endregion float

// #region turntable

/**
 * @typedef {Object} TurntableData
 * @property {boolean} enabled - Whether the turntable rotation is active
 * @property {number} speed - Speed of the rotation in radians per second
 * @property {string} axis - Axis to rotate around (x, y, or z)
 */

/**
 * Adds continuous rotation around a configurable axis to an entity.
 * Creates a turntable-like rotation effect.
 *
 * @this {AFRAME.Component & {data: TurntableData}}
 */
AFRAME.registerComponent("turntable", {
  schema: {
    enabled: { type: "boolean", default: true },
    speed: { type: "number", default: 1 },
    axis: { type: "string", default: "z" },
  },

  init: function () {
    // Store original rotation values
    this.originalRotation = {
      x: this.el.object3D.rotation.x,
      y: this.el.object3D.rotation.y,
      z: this.el.object3D.rotation.z,
    };

    // Store original matrix auto update setting
    this.wasMatrixAutoUpdate = this.el.object3D.matrixAutoUpdate;

    // Disable automatic matrix updates for performance
    this.el.object3D.matrixAutoUpdate = false;
  },

  tick: function (time, delta) {
    /** @type {TurntableData} */
    const data = this.data;

    if (!data.enabled || data.speed === 0) return;

    // Convert delta from milliseconds to seconds
    const deltaSeconds = delta / 1000;

    // Calculate rotation amount
    const rotationAmount = data.speed * deltaSeconds;

    // Apply rotation to the specified axis
    this.el.object3D.rotation[data.axis] += rotationAmount;

    // Manually update the matrix
    this.el.object3D.updateMatrix();
  },

  remove: function () {
    // Restore original rotation
    this.el.object3D.rotation.x = this.originalRotation.x;
    this.el.object3D.rotation.y = this.originalRotation.y;
    this.el.object3D.rotation.z = this.originalRotation.z;

    // Restore original matrix auto update setting
    this.el.object3D.matrixAutoUpdate = this.wasMatrixAutoUpdate;

    // Make sure to update the matrix one last time
    this.el.object3D.updateMatrix();
  },
});

// #endregion turntable

// #region realmar-gallery

// realmar-gallery component manages gallery state and navigation
AFRAME.registerComponent("realmar-gallery", {
  schema: {
    startIndex: { type: "number", default: 0 },
  },

  init: function () {
    this.currentItemIndex = this.data.startIndex;
    this._galleryItems = null;

    // Create methods for navigation
    this.el.galleryAPI = {
      next: () => this.nextItem(),
      prev: () => this.prevItem(),
      setIndex: (index) => this.setItemIndex(index),
      getCurrentIndex: () => this.currentItemIndex,
      getItemCount: () => this.getGalleryItems().length,
    };

    // Wait for scene to be fully loaded
    this.el.sceneEl.addEventListener("loaded", () => {
      this.updateVisibility();
    });
  },

  // Cache gallery items for better performance
  getGalleryItems: function () {
    if (!this._galleryItems) {
      this._galleryItems = Array.from(
        this.el.querySelectorAll("[realmar-gallery-item]")
      );
    }
    return this._galleryItems;
  },

  // Navigation methods with shared logic
  nextItem: function () {
    const items = this.getGalleryItems();
    if (items.length === 0) return;

    this.currentItemIndex = (this.currentItemIndex + 1) % items.length;
    this.updateVisibility();
  },

  prevItem: function () {
    const items = this.getGalleryItems();
    if (items.length === 0) return;

    this.currentItemIndex =
      (this.currentItemIndex - 1 + items.length) % items.length;
    this.updateVisibility();
  },

  setItemIndex: function (index) {
    const items = this.getGalleryItems();
    if (items.length === 0) return;

    if (index >= 0 && index < items.length) {
      this.currentItemIndex = index;
      this.updateVisibility();
    }
  },

  updateVisibility: function () {
    this.el.emit("gallery-index-changed", { index: this.currentItemIndex });
  },

  // Handle dynamic content changes
  update: function () {
    this._galleryItems = null; // Invalidate cache
  },

  remove: function () {
    this._galleryItems = null;
  },
});

// #region realmar-gallery-item

// realmar-gallery-item component listens for index changes and updates its visibility
AFRAME.registerComponent("realmar-gallery-item", {
  schema: {
    index: { type: "number", default: 0 },
  },

  init: function () {
    this.gallery = this.el.closest("[realmar-gallery]");

    if (!this.gallery) {
      console.warn("Gallery item could not find a parent gallery component");
      return;
    }

    // Bind event handler once
    this.onIndexChanged = this.onIndexChanged.bind(this);
    this.gallery.addEventListener("gallery-index-changed", this.onIndexChanged);

    // Set initial visibility (safely)
    if (this.gallery.components["realmar-gallery"]) {
      this.updateVisibility(
        this.gallery.components["realmar-gallery"].currentItemIndex
      );
    }
  },

  onIndexChanged: function (event) {
    this.updateVisibility(event.detail.index);
  },

  updateVisibility: function (currentIndex) {
    const shouldBeVisible = currentIndex === this.data.index;
    const isCurrentlyVisible = this.el.getAttribute("visible");

    if (shouldBeVisible !== isCurrentlyVisible) {
      this.el.setAttribute("visible", shouldBeVisible);
    }
  },

  remove: function () {
    if (this.gallery) {
      this.gallery.removeEventListener(
        "gallery-index-changed",
        this.onIndexChanged
      );
    }
  },
});

// #region animated-image

AFRAME.registerComponent("animated-image", {
  schema: {
    src: { type: "string" },
  },

  init: function () {
    this.texture = null;
    this.material = null;
    this.loadTexture();
  },

  loadTexture: async function () {
    try {
      const src = this.data.src;
      if (!src) return;

      // Get the asset element
      const assetElement = document.querySelector(src);
      if (!assetElement) return;

      // Check if this asset is marked as animated
      const isAnimated =
        assetElement.getAttribute("data-is-animated") === "true";
      if (!isAnimated) {
        // Not animated, let A-Frame handle it normally
        return;
      }
      // Fetch the file
      const response = await fetch(assetElement.src, {
        credentials: "include",
      });
      const arrayBuffer = await response.arrayBuffer();

      let container;

      // Detect format and parse
      if (assetElement.src.toLowerCase().endsWith(".gif")) {
        // eslint-disable-next-line no-undef
        const gifData = parseGIF(arrayBuffer);

        // Decompress frames to get pixel data
        const frames = decompressFrames(gifData, true); // true for buildImagePatches

        container = {
          downscale: false,
          width: gifData.lsd.width,
          height: gifData.lsd.height,
          frames: frames, // This gives us the frame data ComposedTexture expects
        };
      } else if (assetElement.src.toLowerCase().endsWith(".png")) {
        // eslint-disable-next-line no-undef
        const png = UPNG.decode(arrayBuffer);
        const frames = [];

        for (const src of png.frames) {
          if (!src.data) continue;

          frames.push({
            dims: {
              left: src.rect.x,
              top: src.rect.y,
              width: src.rect.width,
              height: src.rect.height,
            },
            patch: src.data,
            blend: src.blend,
            delay: src.delay,
            disposalType: src.dispose,
          });
        }

        container = {
          downscale: false,
          width: png.width,
          height: png.height,
          frames: frames,
        };
      }

      if (container && container.frames.length > 1) {
        // Create ComposedTexture (empty first, then assign for async loading)
        this.texture = new THREE.ComposedTexture();
        await this.texture.assign(container);

        // Wait for texture to be ready
        if (!this.texture.ready) {
          await new Promise((resolve) => {
            this.texture.addEventListener("ready", resolve, { once: true });
          });
        }

        // Ensure texture is playing
        if (!this.texture.isPlaying) {
          this.texture.play();
        }

        // Apply to material - ensure mesh exists (might need to wait for A-Frame to create it)
        const applyTexture = () => {
          const mesh = this.el.object3D.children[0];
          if (mesh && mesh.material) {
            mesh.material.map = this.texture;
            mesh.material.needsUpdate = true;
            this.material = mesh.material; // Store reference for tick updates
            return true;
          }
          return false;
        };

        // Try to apply immediately
        if (!applyTexture()) {
          // If mesh doesn't exist yet, wait a frame and try again
          this.el.sceneEl.addEventListener(
            "renderstart",
            () => {
              applyTexture();
            },
            { once: true }
          );
        }
      }
    } catch (error) {
      console.warn("Failed to load animated texture:", error);
    }
  },

  tick: function (time, delta) {
    if (
      this.texture &&
      this.texture.isComposedTexture &&
      this.texture.ready &&
      this.texture.isPlaying
    ) {
      // Update the texture animation (delta is in milliseconds, convert to seconds)
      this.texture.update(delta / 1000);

      // Ensure material reference exists
      if (!this.material) {
        const mesh = this.el.object3D.children[0];
        if (mesh && mesh.material) {
          this.material = mesh.material;
        }
      }

      // Always update material to see texture canvas changes
      // ComposedTexture updates its canvas in _render(), so we need to tell Three.js to re-upload
      if (this.material) {
        // Force texture and material update every frame when animating
        this.texture.needsUpdate = true;
        this.material.needsUpdate = true;
      }
    }
  },

  remove: function () {
    if (this.texture && this.texture.dispose) {
      this.texture.dispose();
    }
    this.texture = null;
    this.material = null;
  },
});

// #endregion animated-image

// #region realmar-depends-on

AFRAME.registerComponent("realmar-depends-on", {
  schema: { type: "selector" },

  didFindDependency: false,

  init: function () {
    this.didFindDependency = false;
    // cache own the target index
    this.mindArImageTargetIndex = this.el.getAttribute(
      "mindar-image-target"
    )?.targetIndex;

    if (this.mindArImageTargetIndex === undefined) {
      console.warn(
        "realmar-depends-on component requires a mindar-image-target component with a targetIndex"
      );
      return;
    }

    const scene = document.querySelector("a-scene");

    const handleTargetFound = (event) => {
      if (event.target === this.data) {
        console.log("Found dependency:", this.data);
        this.didFindDependency = true;
        this.el.emit("dependency-found");
        scene.removeEventListener("targetFound", handleTargetFound);
      }
    };

    scene.addEventListener("targetFound", handleTargetFound);
  },
});

// #region DOM Controls

function initDomControls(scene) {
  initGalleryControls(scene);
  initVideoControls(scene);
  initLinkControls(scene);
}

function initGalleryControls(scene) {
  // Find gallery buttons
  const galleryButtons = document.getElementById("gallery-buttons");
  const prevButton = galleryButtons.querySelector("#prev");
  const nextButton = galleryButtons.querySelector("#next");

  // Track currently active gallery
  let activeGallery = null;

  // Show/hide gallery buttons based on marker visibility
  scene.addEventListener("targetFound", (event) => {
    const targetEl = event.target;
    const gallery = targetEl.components["realmar-gallery"];

    if (gallery) {
      activeGallery = targetEl;
      galleryButtons.classList.remove("invisible");
    }
  });

  scene.addEventListener("targetLost", (event) => {
    const targetEl = event.target;

    // If the lost target was our active gallery, hide buttons
    if (targetEl === activeGallery) {
      activeGallery = null;
      galleryButtons.classList.add("invisible");
    }
  });

  // Connect button click handlers to gallery API
  prevButton.addEventListener("click", () => {
    if (activeGallery && activeGallery.galleryAPI) {
      activeGallery.galleryAPI.prev();
    }
  });

  nextButton.addEventListener("click", () => {
    if (activeGallery && activeGallery.galleryAPI) {
      activeGallery.galleryAPI.next();
    }
  });
}

function getVideoObjectsFromTarget(targetEl) {
  return [...targetEl.querySelectorAll('a-plane[src^="#"]')]
    .map((plane) => {
      const video = document.querySelector(plane.getAttribute("src"));
      if (video && video.tagName === "VIDEO") {
        return {
          plane,
          video,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function initVideoControls(scene) {
  // Find video controls
  const videoButtons = document.getElementById("video-buttons");
  const playButton = videoButtons.querySelector("#play");
  const pauseButton = videoButtons.querySelector("#pause");
  const replayButton = videoButtons.querySelector("#replay");

  // Track currently active video
  let activeVideoObject = null;

  // Show/hide video buttons based on marker visibility
  scene.addEventListener("targetFound", (event) => {
    const targetEl = event.target;
    // Find video elements in the target
    const videoObjects = getVideoObjectsFromTarget(targetEl);

    // If there are no videos, do nothing
    if (videoObjects.length === 0) {
      return;
    }

    // console.log("Found target with videos:", videoObjects);

    const firstVideoObject = videoObjects[0];

    if (firstVideoObject) {
      activeVideoObject = firstVideoObject;
      if (activeVideoObject.video.dataset.autoplay === "true") {
        activeVideoObject.video.play().catch((e) => {
          console.log("Video play error:", e);
        });
      }
      videoButtons.classList.remove("invisible");
    }
  });

  scene.addEventListener("targetLost", (event) => {
    const targetEl = event.target;

    const videoObjects = getVideoObjectsFromTarget(targetEl);

    // If there are no videos, do nothing
    if (videoObjects.length === 0) {
      return;
    }

    console.log("Lost target with videos:", videoObjects);

    const firstVideoObject = videoObjects[0];

    // If the lost target was our active video, hide buttons
    if (firstVideoObject.video === activeVideoObject.video) {
      firstVideoObject.video.pause();

      activeVideoObject = null;
      videoButtons.classList.add("invisible");
    }
  });

  // Connect button click handlers to video API
  playButton.addEventListener("click", () => {
    if (activeVideoObject && activeVideoObject.video) {
      activeVideoObject.video.play().catch((e) => {
        console.log("Video play error:", e);
      });
    }
  });

  pauseButton.addEventListener("click", () => {
    if (activeVideoObject && activeVideoObject.video) {
      activeVideoObject.video.pause();
    }
  });

  replayButton.addEventListener("click", () => {
    if (activeVideoObject && activeVideoObject.video) {
      activeVideoObject.video.currentTime = 0;
      activeVideoObject.video.play().catch((e) => {
        console.log("Video play error:", e);
      });
    }
  });
}

function initLinkControls(scene) {
  // Find link buttons
  const linkButtons = document.getElementById("link-buttons");
  const linkButton = linkButtons.querySelector("#link-button");

  // Show/hide link buttons based on marker visibility
  scene.addEventListener("targetFound", (event) => {
    const targetEl = event.target;

    // Find the link data from the target element
    // The link data should be available as data attributes or from the item
    const linkUrl = targetEl.getAttribute("data-link-url");
    const linkTitle = targetEl.getAttribute("data-link-title");
    const linkEnabled = targetEl.getAttribute("data-link-enabled") === "true";

    if (linkUrl && linkTitle && linkEnabled) {
      linkButton.href = linkUrl;
      linkButton.textContent = linkTitle;
      linkButtons.classList.remove("invisible");
    }
  });

  scene.addEventListener("targetLost", (event) => {
    const targetEl = event.target;
    const linkUrl = targetEl.getAttribute("data-link-url");
    const linkEnabled = targetEl.getAttribute("data-link-enabled") === "true";

    if (linkUrl && linkEnabled) {
      linkButtons.classList.add("invisible");
      linkButton.href = "#";
      linkButton.textContent = "";
    }
  });
}

// Setup gallery controls after scene is loaded
document.addEventListener("DOMContentLoaded", () => {
  initAudioPermission();

  const scene = document.querySelector("a-scene");
  // If scene isn't loaded yet, wait for it
  if (!scene.hasLoaded) {
    scene.addEventListener("loaded", () => initDomControls(scene));
  } else {
    initDomControls(scene);
  }
});
// #endregion

// #region audio autoplay permission
function initAudioPermission() {
  const splashScreen = document.getElementById("splash-screen");
  const startButton = document.getElementById("start-button");

  if (!splashScreen || !startButton) {
    return;
  }

  // Create audio context - this helps with unlocking audio on iOS
  let audioContext;
  const shouldEnableAudio = (video) => video.dataset.muted !== "true";
  const shouldAutoplay = (video) => video.dataset.autoplay === "true";

  const syncVideoPlayback = (video) => {
    if (shouldEnableAudio(video)) {
      video.muted = false;
    }

    if (shouldAutoplay(video) && video.paused) {
      video.play().catch((e) => console.log("Video play error:", e));
    }
  };

  // Function to unlock audio
  function unlockAudio() {
    // Create audio context if it doesn't exist
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Create and play a silent sound to unlock audio
    if (audioContext.state === "suspended") {
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);
    }

    // Find all video elements
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      syncVideoPlayback(video);
    });

    // Set global flag for future videos
    window.audioPermissionGranted = true;

    // Hide splash screen
    splashScreen.style.display = "none";
  }

  // Add click event listener
  startButton.addEventListener("click", unlockAudio);

  // Monitor for new video elements being added to the scene
  const observer = new MutationObserver((mutations) => {
    if (window.audioPermissionGranted) {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLVideoElement) {
            syncVideoPlayback(node);
          }

          // Check for videos in child elements
          const videos = node.querySelectorAll?.("video");
          if (videos) {
            videos.forEach((video) => {
              syncVideoPlayback(video);
            });
          }
        });
      });
    }
  });

  // Start observing the document with the configured parameters
  observer.observe(document.body, { childList: true, subtree: true });
}

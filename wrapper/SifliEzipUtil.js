/**
 * SFEZIPWasm - EZip WebAssembly 包装层
 * 版本: 2.5.5
 */

// ============================================
// SFBoardType - 板卡类型常量
// ============================================
export const SFBoardType = {
    TYPE_55X: 0,
    TYPE_56X: 1,
    TYPE_52X: 2,
    TYPE_57X: 3,
    TYPE_58X: 4,

    isValidBoardType(boardType) {
        return boardType >= 0 && boardType <= this.TYPE_58X;
    }
};

export const SFEZIPColorType = {
    RGB565: 0,
    RGB565A: 1,
    RGB888: 2,
    RGB888A: 3
};

// ============================================
// SifliEzipUtil - 核心工具类
// ============================================
export class SifliEzipUtil {
    static VersionStr = "2.5.5";
    static _module = null;
    static _ready = false;

    static _checkReady() {
        if (!this._ready) {
            throw new Error('SifliEzipUtil 未初始化，请先调用 setModule()');
        }
    }

    static _allocateBuffer(data) {
        const ptr = this._module._malloc(data.length);
        // 逐个字节写入，使用 u8
        for (let i = 0; i < data.length; i++) {
            this._module.setValue(ptr + i, data[i], 'i8');
        }

        // 验证读回
        const verify = [];
        for (let i = 0; i < 16 && i < data.length; i++) {
            verify.push(this._module.getValue(ptr + i, 'i8'));
        }
        console.log('写入前 16 字节:', Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.log('读回前 16 字节:', verify.map(b => b.toString(16).padStart(2, '0')).join(' '));

        return { ptr, len: data.length };
    }

    static _readAndFreeBuffer(ptr, len) {
        if (ptr === 0 || len === 0) {
            return new Uint8Array(0);
        }
        // 逐个字节读取，使用 u8
        const result = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = this._module.getValue(ptr + i, 'i8');
        }
        this._module._free(ptr);
        return result;
    }

    static _copyDataTo(src, dest, offset) {
        if (offset > dest.length) return;
        const len = src.length;
        for (let i = 0; i < len; i++) {
            dest[offset + i] = src[i];
        }
    }

    /**
     * 外部注入 Wasm 模块实例
     * 由调用方加载后传入
     */
    static setModule(module) {
        if (!module || typeof module._png_to_ezip !== 'function') {
            console.error('传入的模块:', module);
            throw new Error('传入的模块不是有效的 Emscripten 模块');
        }
        
        this._module = module;
        this._ready = true;
        console.log('SifliEzipUtil 初始化成功, 版本:', this.VersionStr);
    }

    /**
     * 初始化 Wasm 模块
     * 自动从服务器加载 /build-wasm/ezip_wasm.js
     */
    static async init() {
        if (this._ready) return;

        try {
            const module = await import('sfezipwasm');
            const loadFn = module.default;
            const instance = await loadFn();
            this._module = instance;

            if (!this._module || typeof this._module._png_to_ezip !== 'function') {
                throw new Error('加载的模块不是有效的 Emscripten 模块');
            }

            this._ready = true;
            console.log('SifliEzipUtil 初始化成功, 版本:', this.VersionStr);
        } catch (error) {
            console.error('SifliEzipUtil 初始化失败:', error);
            throw error;
        }
    }

    // ============================================
    // 公共 API - 直接调用 _函数名
    // ============================================

    static pngToEzip(pngData, colorType, ezip_color_type, ezip_bin_type, boardType) {
        if (colorType === null || colorType === undefined) {
            throw new Error('colorType cannot be null');
        }
        if (pngData === null || pngData === undefined) {
            throw new Error('pngData cannot be null');
        }
        if (!SFBoardType.isValidBoardType(boardType)) {
            console.error(`boardType is invalid ${boardType}`);
            throw new Error(`boardType is invalid. ${boardType}`);
        }

        this._checkReady();

        console.info(`pngToEzip: ${this.VersionStr}`);
        console.info(`pngToEzip: pngData length: ${pngData.length}, colorType: ${colorType}, ezip_color_type: ${ezip_color_type}, ezip_bin_type: ${ezip_bin_type}, boardType: ${boardType}`);

        const inBuf = this._allocateBuffer(pngData);
        const outPtrPtr = this._module._malloc(4);

        // 🔑 直接调用 _png_to_ezip，不用 cwrap
        const resultLen = this._module._png_to_ezip(
            inBuf.ptr,
            inBuf.len,
            colorType,
            ezip_color_type,
            ezip_bin_type,
            boardType,
            outPtrPtr
        );

        const outPtr = this._module.getValue(outPtrPtr, 'i32');
        this._module._free(outPtrPtr);
        this._module._free(inBuf.ptr);

        if (resultLen === 0 || outPtr === 0) {
            throw new Error('PNG 转 EZip 失败');
        }

        return this._readAndFreeBuffer(outPtr, resultLen);
    }

    static pngToEzipSequence(pngDataArray, colorType, ezip_color_type, ezip_bin_type, boardType, interval) {
        const picNum = pngDataArray.length;
        console.info(`${this.VersionStr} color ${ezip_color_type}, bin ${ezip_bin_type}, board ${boardType}, pic number ${picNum}, interval ${interval}`);

        if (!SFBoardType.isValidBoardType(boardType)) {
            console.error(`boardType is invalid ${boardType}`);
            throw new Error(`boardType is invalid. ${boardType}`);
        }
        if (pngDataArray === null || pngDataArray === undefined || picNum === 0) {
            throw new Error('pngDataArray cannot be null or empty');
        }

        this._checkReady();

        const lenArray = [];
        let allLen = 0;
        for (const currentFile of pngDataArray) {
            lenArray.push(currentFile.length);
            allLen += currentFile.length;
        }

        let offset = 0;
        const data = new Uint8Array(allLen);
        for (const currentFile of pngDataArray) {
            this._copyDataTo(currentFile, data, offset);
            offset += currentFile.length;
        }

        const lenArrayPtr = this._module._malloc(lenArray.length * 4);
        for (let i = 0; i < lenArray.length; i++) {
            this._module.setValue(lenArrayPtr + i * 4, lenArray[i], 'i32');
        }

        const inBuf = this._allocateBuffer(data);
        const outPtrPtr = this._module._malloc(4);

        // 🔑 直接调用 _seq_png_to_ezip，不用 cwrap
        const resultLen = this._module._seq_png_to_ezip(
            inBuf.ptr,
            inBuf.len,
            colorType,
            ezip_color_type,
            ezip_bin_type,
            boardType,
            lenArrayPtr,
            lenArray.length,
            interval || 0,
            outPtrPtr
        );

        const outPtr = this._module.getValue(outPtrPtr, 'i32');
        this._module._free(outPtrPtr);
        this._module._free(lenArrayPtr);
        this._module._free(inBuf.ptr);

        if (resultLen === 0 || outPtr === 0) {
            throw new Error('序列 PNG 转 EZip 失败');
        }

        return this._readAndFreeBuffer(outPtr, resultLen);
    }

    static setLvglVersion(lvglVersion) {
        console.info(`setLvglVersion ${lvglVersion}`);
        this._checkReady();
        // 🔑 直接调用 _set_lvgl_version，不用 cwrap
        this._module._set_lvgl_version(lvglVersion);
    }

    static gzipWithData(inData) {
        if (inData === null || inData === undefined) {
            throw new Error('inData cannot be null');
        }

        console.info(`gzipWithData ${inData.length}`);
        this._checkReady();

        const inBuf = this._allocateBuffer(inData);
        const outPtrPtr = this._module._malloc(4);

        // 🔑 直接调用 _gzip_with_data，不用 cwrap
        const resultLen = this._module._gzip_with_data(
            inBuf.ptr,
            inBuf.len,
            outPtrPtr
        );

        const outPtr = this._module.getValue(outPtrPtr, 'i32');
        this._module._free(outPtrPtr);
        this._module._free(inBuf.ptr);

        if (resultLen === 0 || outPtr === 0) {
            throw new Error('GZip 压缩失败');
        }

        return this._readAndFreeBuffer(outPtr, resultLen);
    }
}

export default SifliEzipUtil;
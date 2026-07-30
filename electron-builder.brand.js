const brand = require('./brand.config.json');

const copyright = `Copyright © 2026 ${brand.companyName}`;

// 在静态打包配置的基础上，注入品牌相关的原生应用元数据。
// electron-builder YAML 无法直接读取 brand.config.json，因此通过该文件完成配置转换。
module.exports = {
  extends: './electron-builder.yml',
  productName: brand.displayName,
  executableName: brand.displayName,
  copyright,
  win: {
    legalTrademarks: copyright,
  },
};

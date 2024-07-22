const fs = require("fs");
const yaml = require('js-yaml');

class Config {
    data = [];

    constructor(filePath = "config.yaml") {
        this.data = yaml.load(fs.readFileSync(filePath, 'utf8'));
    }
}

module.exports = Config;

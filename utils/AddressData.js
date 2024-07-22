const fs = require("fs");
const csv = require('fast-csv');

class AddressData {
    filePath = null;
    data = [];

    constructor(filePath = "wallet.csv") {
        // TODO: 如果没有 wallet.csv 创建它
        this.filePath = filePath;
    }

    async load(expectedHeaders = ["Address", "Amount"]) {
        this.data = await this.readCSV(expectedHeaders);
        return this.data;
    }

    readCSV(expectedHeaders) {
        const results = [];

        try {
            const stream = fs.createReadStream(this.filePath);
            const parser = csv.parse({headers: true});

            return new Promise((resolve, reject) => {
                stream.pipe(parser)
                    .on('error', reject)
                    .on('data', row => {
                        const isBlankRow = Object.values(row).every(value => /^\s*$/.test(value));
                        if (!isBlankRow) {
                            const rowData = {};
                            expectedHeaders.forEach(header => {
                                rowData[header] = row[header] ? row[header].trim() : '';
                            });
                            results.push(rowData);
                        }
                    }).on('end', () => resolve(results));
            });
        } catch (error) {
            console.error('Error parsing CSV:', error);
            return [];
        }
    }
}

module.exports = AddressData;

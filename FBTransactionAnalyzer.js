const axios = require('axios');
const fs = require('fs');
const fsPromises = require('fs').promises;
const stream = require('stream');
const { promisify } = require('util');

const pipeline = promisify(stream.pipeline);

const API_BASE_URL = 'https://mempool.ybot.io/api';
const RETRY_DELAY = 3000;
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 30; // 改为 100 毫秒

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url, retries = MAX_RETRIES) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`尝试请求 URL: ${url} (第 ${i + 1} 次尝试)`);
      const response = await axios.get(url);
      console.log(`成功获取数据 (第 ${i + 1} 次尝试)`);
      return response.data;
    } catch (error) {
      console.error(`API 请求失败，状态码: ${error.response ? error.response.status : '未知'}`);
      console.error(`错误信息: ${error.message}`);
      if (i < retries - 1) {
        console.log(`等待 ${RETRY_DELAY / 1000} 秒后进行第 ${i + 2} 次尝试...`);
        await sleep(RETRY_DELAY);
      } else {
        throw error;
      }
    }
  }
};

const getWalletTransactions = async (address) => {
  let allTransactions = [];
  let lastTxid = null;
  let pageCount = 0;
  let stats = { receivedCount: 0, totalReceived: 0, sentCount: 0, totalSent: 0 };
  
  console.log(`开始获取地址 ${address} 的交易数据`);

  while (true) {
    const url = `${API_BASE_URL}/address/${address}/txs${lastTxid ? `?after_txid=${lastTxid}` : ''}`;
    console.log(`正在请求第 ${pageCount + 1} 页数据，URL: ${url}`);
    
    try {
      const transactions = await fetchWithRetry(url);
      pageCount++;
      
      console.log(`成功获取第 ${pageCount} 页数据，包含 ${transactions.length} 条交易记录`);
      
      if (transactions.length === 0) {
        console.log("已获取所有交易数据，没有更多交易");
        break;
      }
      
      for (const tx of transactions) {
        console.log(`正在处理交易，txid: ${tx.txid}`);
        let isReceived = false;
        
        for (const output of tx.vout) {
          if (output.scriptpubkey_address === address) {
            stats.receivedCount++;
            stats.totalReceived += output.value;
            isReceived = true;
            console.log(`  检测到接收交易，金额: ${output.value / 100000000} FB`);
            break;
          }
        }
        
        if (!isReceived) {
          for (const input of tx.vin) {
            if (input.prevout && input.prevout.scriptpubkey_address === address) {
              stats.sentCount++;
              stats.totalSent += input.prevout.value;
              console.log(`  检测到发送交易，金额: ${input.prevout.value / 100000000} FB`);
              break;
            }
          }
        }
      }
      
      allTransactions.push(...transactions);
      lastTxid = transactions[transactions.length - 1].txid;
      console.log(`当前页面的最后一个交易ID: ${lastTxid}`);
      
      if (transactions.length < 10) {
        console.log("返回的交易数量小于10，认为已获取所有交易数据");
        break;
      }
    } catch (error) {
      console.error(`在获取交易数据时发生错误，无法继续:`);
      console.error(error);
      break;
    }
    
    console.log(`等待 ${RATE_LIMIT_DELAY / 1000} 秒后继续下一次请求...`);
    await sleep(RATE_LIMIT_DELAY);
  }
  
  console.log(`总共获取了 ${pageCount} 页交易数据`);
  console.log(`总交易数: ${allTransactions.length}`);
  console.log(`接收交易数: ${stats.receivedCount}, 总接收金额: ${stats.totalReceived / 100000000} FB`);
  console.log(`发送交易数: ${stats.sentCount}, 总发送金额: ${stats.totalSent / 100000000} FB`);
  
  return { transactions: allTransactions, analysis: stats };
};

const formatDate = (timestamp) => {
  return new Date(timestamp * 1000).toISOString().replace('T', ' ').substr(0, 19);
};

const generateCSV = async (transactions, address, filename) => {
  console.log("开始生成CSV文件...");
  const writeStream = fs.createWriteStream(filename);
  
  await pipeline(
    stream.Readable.from([
      'txid,block_height,block_time,transaction_time,type,value\n',
      ...transactions.flatMap(tx => {
        const transactionTime = formatDate(tx.status.block_time);
        return tx.vout
          .filter(output => output.scriptpubkey_address === address)
          .map(output => `${tx.txid},${tx.status.block_height},${tx.status.block_time},${transactionTime},received,${output.value / 100000000}\n`)
          .concat(
            tx.vin
              .filter(input => input.prevout && input.prevout.scriptpubkey_address === address)
              .map(input => `${tx.txid},${tx.status.block_height},${tx.status.block_time},${transactionTime},sent,${input.prevout.value / 100000000}\n`)
          );
      })
    ]),
    writeStream
  );
  
  console.log("CSV文件生成完成");
};

const main = async () => {
  console.log("开始执行主程序");
  
  const address = process.argv[2];
  if (!address) {
    console.error('错误：请提供钱包地址作为参数');
    process.exit(1);
  }
  console.log(`使用的钱包地址: ${address}`);

  console.log("开始获取钱包交易...");
  const { transactions, analysis } = await getWalletTransactions(address);
  console.log("钱包交易获取完成");
  
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = `${address}_${timestamp}_tx.csv`;
  console.log(`将要写入的文件名: ${filename}`);
  
  await generateCSV(transactions, address, filename);
  
  console.log(`交易记录已保存到 ${filename}`);
  console.log(`该钱包地址共收到 ${analysis.receivedCount} 笔交易，总共收到 ${analysis.totalReceived / 100000000} FB`);
  console.log(`该钱包地址共转出 ${analysis.sentCount} 笔交易，总共转出 ${analysis.totalSent / 100000000} FB`);
  
  console.log("程序执行完毕");
};

main().catch(error => {
  console.error("程序执行过程中发生错误:");
  console.error(error);
  process.exit(1);
});

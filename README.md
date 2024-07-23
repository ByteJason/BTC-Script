# 1. 基本介绍
- 本项目是一个基于 `nodejs` 的 BTC P2TR 地址收款地址批量转账脚本，用于在 BTC 主网、Signet Test、Testnet3、Fractal 四个网络之间进行批量转账
- 本项目基于 `mempool.space` 提供的 `API` 进行开发，具体可以参考 [https://mempool.space/docs/api](https://mempool.space/docs/api)
- issue 仅用于提交 Bug 或 Feature 以及设计相关的内容，其它内容可能会被直接关闭。
- 作者 [https://x.com/ByteJason](https://x.com/ByteJason)
- 本项目仅供学习研究使用，请勿用于非法用途，否则后果自负！


# 2. 使用说明

## 2.1 安装环境

- 安装 nodejs >= 18.18 的版本
  - 可以在 [https://nodejs.org/](https://nodejs.org/zh-cn/download/package-manager) 进行下载适合系统的环境安装包进行安装
- 安装好之后使用如下命令查看是否成功安装，如果都能看到版本号信息，既代表安装完成
  - ```
    node -v
    npm -v
    ```

## 2.2 安装依赖
- 在项目根目录下执行如下命令，安装依赖
  - ```
    npm install
    ```

## 2.3 编辑配置文件
- 复制 `config.yaml-example` 文件，粘贴名称为 `config.yaml` ，然后，修改里面 `config.yaml` 的配置信息
  - `base_url`: 修改为您需要交互的 BTC网络，可选值暂时为下面四个选项
    - `主网`: https://mempool.space/api
    - `Signet Test`: https://mempool.space/signet/api
    - `Testnet3`: https://mempool.space/testnet/api
    - `Fractal`: https://fractalbitcoin-mempool.unisat.io/api
  - `wif`: 需要支出的 BTC P2TR地址（主网是bc1p开头，测试网是tb1p开头）的 `WIF` 私钥

## 2.4 编辑 `wallet.csv` 收款钱包文件
- 在项目根目录下找到 `wallet.csv` 文件，编辑里面的收款钱包地址与金额，一行一个
- - 复制 `wallet.csv-example` 文件，粘贴名称为 `wallet.csv` ，然后，编辑 `wallet.csv` 里面的收款钱包地址与金额，一行一个

## 2.5 执行脚本
- 在项目根目录下执行如下命令，执行脚本
  - ```shell
    node transfer.js
    ```

# 商用注意事项
如果您将此项目用于商业用途，请遵守Apache2.0协议并保留作者技术支持声明。

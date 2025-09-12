/**
 * 截取字符串中间部分，保留前后指定长度
 * @param {string} str - 要截取的字符串
 * @param {number} frontLen - 前面保留的长度
 * @param {number} backLen - 后面保留的长度
 * @returns {string} 截取后的字符串
 */
function truncateMiddle(str, frontLen, backLen) {
  if (typeof str !== 'string' || str.length <= frontLen + backLen) {
    return str;
  }
  const head = str.slice(0, frontLen);
  const tail = str.slice(str.length - backLen);
  return `${head}…${tail}`;
}

/**
 * 解析UTXO字符串格式 "txid:vout:value"
 * @param {string} inputString - 格式化的UTXO字符串
 * @returns {Array<Object>} 解析后的UTXO对象数组
 */
function splitHashString(inputString) {
  if (typeof inputString !== "string") return [];

  const parts = inputString.split(":");
  if (parts.length !== 3) return [];

  return [{
    txid: parts[0],
    vout: parseInt(parts[1], 10),
    status: {}, // 保持结构一致性
    value: parseInt(parts[2], 10)
  }];
}



/**
 * 获取过滤后的UTXO列表
 * @param {string} btcAddress - 比特币地址
 * @param {number} mintValue - 最小金额过滤值
 * @returns {Promise<Array>} 过滤后的UTXO数组
 */
async function getFilteredUTXOs(btcAddress, mintValue = 0) {
  try {
    const response = await fetch(`https://mempool.space/api/address/${btcAddress}/utxo`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // 按金额降序排序
    const sortedData = data.sort((a, b) => b.value - a.value);
    
    // 过滤掉特殊金额的UTXO
    const EXCLUDED_VALUES = [546, 10000, 330];
    const filteredData = sortedData.filter(utxo => 
      !EXCLUDED_VALUES.includes(utxo.value) && utxo.value > mintValue
    );

    return filteredData || [];
  } catch (error) {
    console.error('获取UTXO失败:', error);
    return [];
  }
}



/**
 * 通过mempool.space广播交易
 * @param {string} rawTxHex - 原始交易十六进制字符串
 * @returns {Promise<Object>} 广播结果对象
 */
async function mempoolbroadcastTx(rawTxHex) {
  try {
    const response = await fetch("https://mempool.space/api/tx", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: rawTxHex.trim()
    });

    const responseText = await response.text();

    if (!response.ok) {
      // 尝试解析JSON错误信息
      const jsonMatch = responseText.match(/{.*}$/);
      if (jsonMatch) {
        try {
          const errorJson = JSON.parse(jsonMatch[0]);
          return {
            success: false,
            code: errorJson.code,
            message: errorJson.message
          };
        } catch (parseError) {
          // JSON解析失败，使用原始错误信息
        }
      }
      
      return {
        success: false,
        code: response.status,
        message: responseText || "未知错误"
      };
    }

    return {
      success: true,
      txid: responseText.trim()
    };

  } catch (error) {
    return {
      success: false,
      code: -1,
      message: error.message
    };
  }
}



async function getLargestConfirmedUTXO(btcaddress, needmoney) {
  try {
    const response = await fetch("https://mempool.space/api/address/" + btcaddress + "/utxo");
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

 
    const validUTXOs = data.filter(
      utxo => utxo.status.confirmed && utxo.value !== 546 && utxo.value !== 10000 && utxo.value !== 330
    ); 
    
    if (validUTXOs.length === 0) return null;

    // 按金额从大到小排序
    validUTXOs.sort((a, b) => b.value - a.value);

    // 贪心算法：选择最少的UTXO来凑齐所需金额
    const selectedUTXOs = [];
    let totalValue = 0;
    
    for (const utxo of validUTXOs) {
      selectedUTXOs.push(utxo);
      totalValue += utxo.value;
      
      // 如果已经凑齐所需金额，返回选中的UTXO
      if (totalValue >= needmoney) {
        return {
          success: true,
          utxos: selectedUTXOs,
          totalValue: totalValue,
          change: totalValue - needmoney
        };
      }
    }
    
    // 如果所有UTXO加起来都不够，返回还差多少
    return {
      success: false,
      utxos: selectedUTXOs,
      totalValue: totalValue,
      shortage: needmoney - totalValue
    };

  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}




async function getTxfee(txid) {
  const url = `https://mempool.space/api/tx/${txid}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`请求失败，状态码：${response.status}`);
    }

    const data = await response.json();
   
    return data.fee; 
  } catch (error) {
    throw new Error(`❌ 请求出错： ${error.message}`); 
  }
}

async function getOutspendsFee(txid, visited = new Set()) {
  if (visited.has(txid)) return 0;
  visited.add(txid);

  const url = `https://mempool.space/api/tx/${txid}/outspends`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`获取 outspends 失败，状态码：${response.status}`);
  }

  const data = await response.json();

  // 获取所有直接子交易 ID（去重、去空值）
  const childTxids = Array.from(
    new Set(data.map(item => item.txid).filter(Boolean))
  );

  let totalFee = 0;

  for (const child of childTxids) {
    const fee = await getTxfee(child); // 你已有的函数
    totalFee += fee;

    // 递归获取孙子交易的费用 
    totalFee += await getOutspendsFee(child, visited);
  }

  return totalFee;
}


async function checkAndExtractMyInputs(txid, myAddress) {
  const url = `https://mempool.space/api/tx/${txid}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`请求失败，状态码：${response.status}`);
    }

    const data = await response.json();
  
    if (data.status.confirmed) { 
      throw new Error(`🚫 交易已经确认了，没办法替换交易。`); 
    }
 
    // 过滤属于你地址的输入
    const myInputs = data.vin 
      .filter(vin => 
        vin.prevout?.scriptpubkey_address === myAddress && 
        vin.prevout?.value !== 546 &&
        vin.prevout?.value !== 10000 &&
        vin.prevout?.value !== 330
      ) 
      .map((vin, index) => {
        return { 
          input_index: index,  
          prev_txid: vin.txid, 
          prev_vout: vin.vout,  
          address: vin.prevout.scriptpubkey_address,
          value: vin.prevout.value,
        };
      });

    if (myInputs.length === 0) { 
      throw new Error(`不是您的交易，请更换钱包。`); 
    } else {
      console.log("🔍 你的输入：", myInputs);
    }

    return myInputs; 
  } catch (error) {
    throw new Error(`❌ 出错： ${error.message}`); 
  }
}


$(document).ready(function () {
  $('#connectWallet').on('click', async function () {
    if (typeof window.unisat == 'undefined') { 
      showNotification('钱包没安装 ！', 'error');
      return
    }
    
    const savedAddress = localStorage.getItem('btcWalletAddress');

    try {
      if (savedAddress) {
        await disconnectWallet();
      } else {
        await connectWallet();
      }
    } catch (e) {
      showNotification(err.message, 'error');
      return;
    } 
  });
});

 

/**
 * 连接比特币钱包
 * @returns {Promise<void>}
 */
async function connectWallet() {
  try {
    // 显示加载状态
    const $connectBtn = $('#connectWallet');
    $connectBtn.html('<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>连接中...');
    $connectBtn.prop('disabled', true);
    
    // 请求钱包账户
    const walletAddresses = await window.unisat.requestAccounts();
    
    if (walletAddresses && walletAddresses.length > 0) {
      // 保存钱包地址
      localStorage.setItem('btcWalletAddress', walletAddresses[0]);
      
      // 显示成功通知
      showNotification('钱包连接成功！', 'success');
      
      // 重新加载页面以更新UI
      location.reload();
    } else {
      throw new Error('未获取到钱包地址');
    }
  } catch (error) {
    console.error('钱包连接失败:', error);
    showNotification(error.message || '钱包连接失败', 'error');
  }
}

/**
 * 断开钱包连接
 * @returns {Promise<void>}
 */
async function disconnectWallet() {
  try {
    // 显示加载状态
    const $connectBtn = $('#connectWallet');
    $connectBtn.html('<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>断开中...');
    $connectBtn.prop('disabled', true);
    
    // 模拟断开过程
    setTimeout(() => {
      // 隐藏钱包信息
      $('#walletInfo').addClass('d-none');
      $('#walletAddress').text('');
      
      // 重置按钮
      $connectBtn.html('<i class="fas fa-wallet me-2"></i>连接BTC钱包');
      $connectBtn.prop('disabled', false);
      
      // 清除本地存储
      localStorage.removeItem('btcWalletAddress');
      
      // 显示通知
      showNotification('钱包已断开连接', 'warning');
      
      // 恢复连接行为
      $connectBtn.off('click').on('click', connectWallet);
    }, 250);
  } catch (error) {
    console.error('断开钱包失败:', error);
    showNotification('断开钱包失败', 'error');
  }
}



// Check if wallet is already connected (from session)
$(document).ready(function() {
  const savedAddress = localStorage.getItem('btcWalletAddress');
  
  if (savedAddress) {
    // Show wallet info
    $('#walletInfo').removeClass('d-none');
    $('#walletAddress').text(truncateMiddle(savedAddress, 6, 6));
    
    // Update button state
    const $connectBtn = $('#connectWallet');
    $connectBtn.html('<i class="fas fa-link-slash me-2"></i>断开连接');
    
    // Update button behavior to disconnect
    $connectBtn.off('click').on('click', disconnectWallet);
  }
});


/**
 * 检查钱包是否已连接
 * @returns {boolean} 钱包连接状态
 */
function isWalletConnected() {
  return localStorage.getItem('btcWalletAddress') !== null;
}


/**
 * 解析目标地址文本（每行一个地址）
 * @param {string} addressText - 包含地址的文本
 * @returns {Array<string>} 解析后的地址数组
 */
function parseTargetAddresses(addressText) {
  if (!addressText) return [];
  
  return addressText
    .split('\n')
    .map(addr => addr.trim())
    .filter(addr => addr.length > 0);
}



/**
 * 计算交易大小
 * @param {number} inputCount - 输入数量
 * @param {number} outputCount - 输出数量
 * @param {number} opReturnSize - OP_RETURN大小
 * @returns {number} 交易大小
 */
function calTransSize(inputCount, outputCount, opReturnSize) {
  const TRANSACTION_CONSTANTS = {
    inputSize: 58,      // P2TR输入大小
    outputSize: 43,     // P2TR输出大小
    baseSize: 11        // 固定开销
  };
  
  return TRANSACTION_CONSTANTS.baseSize 
    + (TRANSACTION_CONSTANTS.inputSize * inputCount) 
    + (TRANSACTION_CONSTANTS.outputSize * outputCount) 
    + opReturnSize;
}
 


/**
 * 动态UTXO选择算法，支持找零输出
 * @param {Array<{txid:string, vout:number, value:number}>} utxos - 按金额降序排序的UTXO列表
 * @param {number} paymentAmount - 支付金额（satoshi）
 * @param {number} feeRate - 费率（sat/vB）
 * @param {number} opReturnSize - OP_RETURN输出大小（vB），无则传0
 * @param {number} dustLimit - 找零阈值（satoshi）
 * @returns {Array} 选中的UTXO数组，不足则返回空数组
 */
function selectUtxosWithChange(utxos, paymentAmount, feeRate, opReturnSize = 0, dustLimit = 330) {
  const selected = [];
  let accumulatedValue = 0;

  // 交易大小常量
  const TRANSACTION_CONSTANTS = {
    headerSize: 10.5,    // 版本、marker/flag、nIn、nOut、locktime
    inputSize: 57.5,     // P2TR输入大小
    outputSize: 43       // P2TR输出大小
  };

  for (const utxo of utxos) {
    selected.push(utxo);
    accumulatedValue += utxo.value;

    const inputCount = selected.length;
    const outputsBeforeChange = 1 + (opReturnSize > 0 ? 1 : 0);
    
    // 计算包含找零的交易大小
    const txSizeWithChange = TRANSACTION_CONSTANTS.headerSize
      + inputCount * TRANSACTION_CONSTANTS.inputSize
      + outputsBeforeChange * TRANSACTION_CONSTANTS.outputSize
      + opReturnSize
      + TRANSACTION_CONSTANTS.outputSize; // 找零输出

    const feeWithChange = Math.ceil(txSizeWithChange * feeRate);
    const changeAmount = accumulatedValue - paymentAmount - feeWithChange;

    // 如果找零足够，返回选中的UTXO
    if (changeAmount >= dustLimit) {
      return selected;
    }

    // 如果找零不足，重新计算不包含找零的交易
    const txSizeWithoutChange = TRANSACTION_CONSTANTS.headerSize
      + inputCount * TRANSACTION_CONSTANTS.inputSize
      + outputsBeforeChange * TRANSACTION_CONSTANTS.outputSize
      + opReturnSize;

    const feeWithoutChange = Math.ceil(txSizeWithoutChange * feeRate);
    
    // 如果足够支付且不需要找零，也可以返回
    if (accumulatedValue >= paymentAmount + feeWithoutChange) {
      return selected;
    }
  }

  // 所有UTXO都不足
  return [];
}

/**
 * 计算交易虚拟字节大小
 * @param {Array} chosenUtxos - 选中的UTXO数组
 * @param {number} outputCount - 输出数量
 * @param {number} opReturnSize - OP_RETURN大小
 * @param {number} changeCount - 找零输出数量
 * @returns {number} 交易虚拟字节大小
 */
function gettxVsize(chosenUtxos, outputCount = 1, opReturnSize = 0, changeCount = 0) {
  const TRANSACTION_CONSTANTS = {
    headerSize: 10.5,    // 版本、marker/flag、nIn、nOut、locktime
    inputSize: 57.5,     // P2TR输入大小
    outputSize: 43       // P2TR输出大小
  };

  const txSize = TRANSACTION_CONSTANTS.headerSize
    + chosenUtxos.length * TRANSACTION_CONSTANTS.inputSize
    + outputCount * TRANSACTION_CONSTANTS.outputSize
    + opReturnSize
    + changeCount * TRANSACTION_CONSTANTS.outputSize;

  return Math.ceil(txSize);
}

/**
 * 计算交易找零金额
 * @param {Array<{value:number}>} chosenUtxos - 选中的UTXO列表
 * @param {number} paymentAmount - 支付金额（satoshi）
 * @param {number} feeRate - 费率（sat/vB）
 * @param {number} outputCount - 输出数量
 * @param {number} opReturnSize - OP_RETURN大小（vB）
 * @param {number} dustLimit - 找零阈值（satoshi）
 * @param {number} changeCount - 找零输出数量
 * @returns {number} 找零金额，不足则返回负数
 */
function calculateChange(
  chosenUtxos,
  paymentAmount,
  feeRate,
  outputCount,
  opReturnSize = 0,
  dustLimit = 330,
  changeCount = 0
) {
  // 计算总输入金额
  const totalInputValue = chosenUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
  
  // 计算交易大小
  const txSize = gettxVsize(chosenUtxos, outputCount, opReturnSize, changeCount);
  
  // 计算手续费
  const feeAmount = Math.ceil(txSize * feeRate);
  
  // 计算找零
  const rawChange = totalInputValue - paymentAmount - feeAmount;
  
  // 如果余额不足，返回负数
  if (rawChange < 0) {
    return rawChange;
  }
  
  // 如果找零小于阈值，返回0（不创建找零输出）
  return rawChange >= dustLimit ? rawChange : 0;
}

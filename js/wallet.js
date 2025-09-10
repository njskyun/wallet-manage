function truncateMiddle(str, frontLen, backLen) {
  if (typeof str !== 'string' || str.length <= frontLen + backLen) {
    return str;
  }
  const head = str.slice(0, frontLen);
  const tail = str.slice(str.length - backLen);
  return head + '…' + tail;
}

function splitHashString(inputString) {
  if (typeof inputString !== "string") return [];

  const parts = inputString.split(":");
  if (parts.length !== 3) return [];

  return [{
    txid: parts[0],
    vout: parseInt(parts[1]),
    status: {}, // 可选，保持结构一致
    value: parseInt(parts[2])
  }];
}



async function getFilteredUTXOs(btcaddress) {
  try {
    const response = await fetch("https://mempool.space/api/address/" + btcaddress + "/utxo");
    // const response = await fetch("https://mempool.fractalbitcoin.io/api/address/" + btcaddress + "/utxo");
    
    const data = await response.json();
 
    // Sort by value in descending order
    const sortedData = data.sort((a, b) => b.value - a.value);
 
    // Filter out UTXOs with value less than 10000
    const filteredData = sortedData.filter(utxo => utxo.value > 10000); 

    return filteredData ? filteredData : [];
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
}



async function mempoolbroadcastTx(rawTxHex) {
  try {
    const res = await fetch("https://mempool.space/api/tx", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: rawTxHex.trim()
    });

    const text = await res.text();

    if (!res.ok) {
      // 尝试提取 JSON 错误体
      const match = text.match(/{.*}$/);
      if (match) {
        const errJson = JSON.parse(match[0]);
        return {
          success: false,
          code: errJson.code,
          message: errJson.message
        };
      }
      return {
        success: false,
        code: res.status,
        message: text || "Unknown error"
      };
    }

    // 成功时返回 txid
    return {
      success: true,
      txid: text.trim()
    };

  } catch (err) {
    return {
      success: false,
      code: -1,
      message: err.message
    };
  }
}



async function getLargestConfirmedUTXO(btcaddress, needmoney) {
  try {
    const response = await fetch("https://mempool.space/api/address/" + btcaddress + "/utxo");
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    // 筛选：已确认 + 金额大于 1000 sats
    const validUTXOs = data.filter(
      utxo => utxo.value > 1000 && utxo.status.confirmed
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
        vin.prevout?.value > 1000
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

 

// Mock function to simulate wallet connection
// In a real app, this would use an actual BTC wallet connection library
async function connectWallet() {
  try { 
      // Show loading effect
      const $connectBtn = $('#connectWallet'); 
      $connectBtn.html('<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>连接中...');
      $connectBtn.prop('disabled', true);
       
      walletAddress = await window.unisat.requestAccounts(); 
      if (walletAddress) {
          // Store in session
          localStorage.setItem('btcWalletAddress', walletAddress[0]);
          // Show success notification
          showNotification('钱包连接成功！', 'success');  
          location.reload();
       }
  } catch (err) { 
      showNotification(err.message, 'error');
  }
}

// Disconnect wallet function
async function disconnectWallet() {
  // Show loading effect
  const $connectBtn = $('#connectWallet');
  $connectBtn.html('<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>断开中...');
  $connectBtn.prop('disabled', true);
  
  // Simulate disconnect
  setTimeout(function() {
    // Hide wallet info
    $('#walletInfo').addClass('d-none');
    $('#walletAddress').text('');
    
    // Reset button
    $connectBtn.html('<i class="fas fa-wallet me-2"></i>连接BTC钱包');
    $connectBtn.prop('disabled', false);
    
    // Clear session
    localStorage.removeItem('btcWalletAddress');
 
    // Show notification
    showNotification('钱包已断开连接', 'warning'); 
    
    // Restore original connect behavior
    $connectBtn.off('click').on('click', connectWallet);
  }, 255);
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


function isWalletConnected() {
  return localStorage.getItem('btcWalletAddress') !== null;
}


// Parse textarea containing target addresses (one per line)
function parseTargetAddresses(addressText) {
  if (!addressText) return [];
  
  // Split by newline and filter out empty lines
  return addressText.split('\n')
    .map(addr => addr.trim())
    .filter(addr => addr.length > 0);
}



function calTransSize(inputUtxoNum, outUtxoNum) {
  const inputSizeP2TR = 58;  // P2TR 输入大小
  const outputSizeP2TR = 43;  // P2TR 输出大小
  const baseTransactionSize = 11;  // 固定开销
  
  return (baseTransactionSize + (inputSizeP2TR * inputUtxoNum) + (outputSizeP2TR * outUtxoNum));
}
 


/**
 * 动态 UTXO 选择，含找零输出
 * @param {Array<{txid:string, vout:number, value:number}>} utxos
 *   按 value 降序排序的 UTXO 列表
 * @param {number} paymentAmount
 *   要支付给对方的金额（satoshi）
 * @param {number} feeRate
 *   费率，单位 sat/vB
 * @param {number} opReturnSize
 *   OP_RETURN 输出的 vsize（若无，则传 0）
 * @param {number} dustLimit
 *   找零阈值（satoshi），小于此值不创建找零输出
 * @returns {Array} 选中的 UTXO 数组，如果不足则返回空数组
 */
function selectUtxosWithChange(
  utxos,
  paymentAmount,
  feeRate,
  opReturnSize = 0,
  dustLimit = 330
) {
  const selected = [];
  let accValue = 0;

  // 常量估算值
  const headerSize = 10.5;   // 版本、marker/flag、nIn、nOut、locktime
  const inputSize  = 57.5;     // P2TR 输入
  const payOutSize = 43;     // P2TR 支付输出

  for (let i = 0; i < utxos.length; i++) {
    selected.push(utxos[i]);
    accValue += utxos[i].value;

    const inputCount = selected.length;
    const outputsBeforeChange = 1                       // 对方支付
                             + (opReturnSize > 0 ? 1 : 0)  // OP_RETURN
                             ;
    // 先假设会产生找零：输出数 +1
    let outputCount = outputsBeforeChange + 1;

    // 计算交易大小：头 + 输入*inputSize + 支付输出*payOutSize + OP_RETURN + 找零输出*payOutSize
    const txSize = headerSize
                 + inputCount * inputSize
                 + (outputsBeforeChange * payOutSize)
                 + opReturnSize
                 + payOutSize; // 找零输出也是一个 P2TR 输出

    const feeSat = Math.ceil(txSize * feeRate);

    // 此时需要总额为 paymentAmount + feeSat
    // 但如果“找零金额”小于 dustLimit，则实际上不会创建找零输出
    const change = accValue - paymentAmount - feeSat;
    if (change >= dustLimit) {
      // 找零足够时，以上计算正确
      return selected;
    } else {
      // 如果累加后 change < dustLimit，则不应该单独创建找零
      // 这时输出数应当少 1（不创建找零），重新计算 txSize 和 feeSat
      outputCount = outputsBeforeChange;
      const txSizeNoChange = headerSize
                           + inputCount * inputSize
                           + outputsBeforeChange * payOutSize
                           + opReturnSize;
      const feeNoChange = Math.ceil(txSizeNoChange * feeRate);

      // 如果 accValue 已足够支付 paymentAmount + feeNoChange，则也可以停止
      if (accValue >= paymentAmount + feeNoChange) {
        return selected;
      }
    }
    // 否则继续下一个 UTXO
  }

  // 遍历完成仍不足
  return [];
}

function gettxVsize(chosenUtxos, outnum = 1, opReturnSize = 0, changeCount = 1) {
  const headerSize = 10.5;   // 版本、marker/flag、nIn、nOut、locktime
  const inputSize  = 57.5;     // P2TR 输入约 57.5 vB 向上取整
  const payOutSize = 43;     // P2TR 支付或找零输出

  //计算交易虚拟字节大小 (vsize)
  const txSize = headerSize
    + chosenUtxos.length * inputSize
    + outnum * payOutSize
    + opReturnSize
    + changeCount * payOutSize;

  return Math.ceil(txSize);
}

/**
 * 计算在选定 UTXO、支付 & OP_RETURN 输出后，交易产生的找零金额
 *
 * @param {Array<{value:number}>} chosenUtxos   已选定的 UTXO 列表（只需 value 字段）
 * @param {number} paymentAmount                支付给对方的金额（satoshi）
 * @param {number} feeRate                      费率（sat/vB）
 * @param {number} opReturnSize                 OP_RETURN 输出大小（vB），无则传 0
 * @param {number} dustLimit                    找零尘埃阈值（satoshi）
 * @returns {number} 实际找零金额（≥ dustLimit），否则返回 0
 */
function calculateChange(
  chosenUtxos,
  paymentAmount,
  feeRate,
  outnum,
  opReturnSize = 0,
  dustLimit = 330,
  changeCount = 1
) {
 
  // 1. 累加所有选中 UTXO 的总值
  const totalInputValue = chosenUtxos.reduce((sum, u) => sum + u.value, 0);
 
 
  // 3. 计算交易虚拟字节大小 (vsize)
  const txSize = gettxVsize(chosenUtxos, outnum, opReturnSize, changeCount)

  // 4. 动态手续费
  const feeSat = Math.ceil(txSize * feeRate);

  // 5. 计算找零
  const rawChange = totalInputValue - paymentAmount - feeSat;

  // 6. 小于尘埃阈值则不创建找零
  if (rawChange < 0) {
    return rawChange;
  }

  return rawChange >= dustLimit ? rawChange : 0;
}

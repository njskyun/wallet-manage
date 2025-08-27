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


async function getLargestConfirmedUTXO(btcaddress) {
  try {
    const response = await fetch("https://mempool.space/api/address/" + btcaddress + "/utxo");
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    // 筛选：已确认 + 金额大于 10000 sats
    const validUTXOs = data.filter(
      utxo => utxo.value > 1000 && utxo.status.confirmed
    ); 
    
    if (validUTXOs.length === 0) return null;

    // 按金额从大到小排序
    validUTXOs.sort((a, b) => b.value - a.value);

    // 返回最大的一笔
    return validUTXOs[0];

  } catch (error) {
    console.error('Error:', error);
    return null;
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
  // 常量估算值
  const headerSize = 10.5;   // 版本、marker/flag、nIn、nOut、locktime
  const inputSize  = 57.5;     // P2TR 输入约 57.5 vB 向上取整
  const payOutSize = 43;     // P2TR 支付或找零输出

  // 1. 累加所有选中 UTXO 的总值
  const totalInputValue = chosenUtxos.reduce((sum, u) => sum + u.value, 0);
 
 
  // 3. 计算交易虚拟字节大小 (vsize)
  const txSize = headerSize
               + chosenUtxos.length * inputSize
               + outnum * payOutSize
               + opReturnSize
               + changeCount * payOutSize;

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

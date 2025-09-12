import { Buffer } from 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm';

// 获取保存的钱包地址
const savedAddress = localStorage.getItem('btcWalletAddress');

// 全局变量
let transactionVsize = 0;
let originalFee = 0;

/**
 * 初始化替换交易页面
 */
async function initializeReplacePage() {
  if (!isWalletConnected()) {
    showNotification('请先连接钱包', 'error');
    return;
  }

  if (!savedAddress) return;
  
  // 设置目标地址为当前钱包地址
  $('#taddr').val(savedAddress);
}

$(document).ready(function() { 
  initializeReplacePage();
  

  // 初始化滑块
  initializeFeeSlider();
  
  // 监听交易哈希输入
  document.getElementById("hash").addEventListener("input", handleTransactionHashInput);
 
 
  // 初始化滑块
  initializeFeeSlider();
  
  // 监听交易哈希输入
  document.getElementById("hash").addEventListener("input", handleTransactionHashInput);
});

/**
 * 初始化费用滑块
 */
function initializeFeeSlider() {
  const slider = document.getElementById("addsats");
  const output = document.getElementById("addsatsValue");
  
  // 滑块输入事件
  slider.addEventListener("input", (e) => {
    updateSliderDisplay(e.target);
    updateFeeRate(e.target.value);
  });
  
  // 初始化显示
  updateSliderDisplay(slider);
}

/**
 * 更新滑块显示
 * @param {HTMLElement} slider - 滑块元素
 */
function updateSliderDisplay(slider) {
  const output = document.getElementById("addsatsValue");
  output.textContent = slider.value;
  updateRangeBackground(slider);
}

/**
 * 更新滑块背景
 * @param {HTMLElement} element - 滑块元素
 */
function updateRangeBackground(element) {
  const val = (element.value - element.min) / (element.max - element.min) * 100;
  element.style.setProperty("--val", val + "%");
}

/**
 * 更新费率显示
 * @param {string} totalFee - 总费用
 */
function updateFeeRate(totalFee) { 
  let feeRate = 0;
  if (transactionVsize !== 0) {
    feeRate = Number(totalFee) / transactionVsize;
  }
  
  $('#feerateDisplay').text(feeRate.toFixed(2));
}

/**
 * 处理交易哈希输入
 * @param {Event} event - 输入事件
 */
async function handleTransactionHashInput(event) {
  const txid = event.target.value.trim();
  if (!txid) return;

  try {
    // 获取我的输入
    const myInputs = await checkAndExtractMyInputs(txid, savedAddress);
    transactionVsize = gettxVsize(myInputs);

    // 获取费用信息
    const currentFee = await getTxfee(txid);
    const totalSpendFee = await getOutspendsFee(txid);
    const minFee = Math.floor(currentFee + totalSpendFee);

    // 更新滑块
    updateSliderWithFeeInfo(minFee);

  } catch (error) {
    console.error('处理交易哈希失败:', error);
    showNotification(error.message, 'error');
  }
}

/**
 * 更新滑块费用信息
 * @param {number} minFee - 最小费用
 */
function updateSliderWithFeeInfo(minFee) {
  const slider = document.getElementById("addsats");
  const output = document.getElementById("addsatsValue");
  
  // 设置滑块范围
  slider.min = minFee;
  slider.max = minFee * 30;
  slider.value = minFee;
  
  // 更新显示
  output.textContent = minFee;
  originalFee = minFee;
  
  // 触发更新事件
  slider.dispatchEvent(new Event('input'));
  updateRangeBackground(slider);
}


  // 替换交易表单提交
  $('#utxoForm').on('submit', function(e) {
    e.preventDefault();
    handleReplaceFormSubmit();
  });

/**
 * 处理替换交易表单提交
 */
function handleReplaceFormSubmit() {
  // 检查钱包连接状态
  if (!isWalletConnected()) {
    showNotification('请先连接钱包', 'error');
    return;
  }
  
  // 获取表单数据
  const formData = {
    hash: $('#hash').val().trim(),
    targetAddress: $('#taddr').val().trim(),
    additionalSats: Math.ceil($('#addsats').val().trim())
  };
  
  // 验证表单数据
  const validationResult = validateReplaceFormData(formData);
  if (!validationResult.isValid) {
    showNotification(validationResult.message, 'error');
    return;
  }
  
  // 显示交易确认模态框
  showTransactionModal('replace', {
    hash: formData.hash,
    targetAddresses: formData.targetAddress,
    addsats: formData.additionalSats
  });
}

/**
 * 验证替换交易表单数据
 * @param {Object} formData - 表单数据
 * @returns {Object} 验证结果
 */
function validateReplaceFormData(formData) {
  const { hash, targetAddress, additionalSats } = formData;
  
  if (!hash || !targetAddress || !additionalSats) {
    return {
      isValid: false,
      message: '请填写所有必填字段'
    };
  }
  
  // 验证交易哈希格式
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
    return {
      isValid: false,
      message: '请输入有效的交易哈希'
    };
  }
  
  // 验证地址格式（简单验证）
  if (targetAddress.length < 26 || targetAddress.length > 62) {
    return {
      isValid: false,
      message: '请输入有效的比特币地址'
    };
  }
  
  // 验证费用
  if (additionalSats <= 0) {
    return {
      isValid: false,
      message: '费用必须大于0'
    };
  }
  
  return { isValid: true };
}

/**
 * 显示交易确认模态框
 * @param {string} type - 交易类型
 * @param {Object} data - 交易数据
 */
function showTransactionModal(type, data) {
  // 设置确认按钮事件
  $('#confirmTransaction').off('click').on('click', function() {
    processReplaceTransaction(data);
  });
  
  // 设置交易详情
  $("#confirmaddr").text(data.targetAddresses);
  
  // 显示模态框
  const transactionModal = new bootstrap.Modal(document.getElementById('transactionModal'));
  transactionModal.show();
}

/**
 * 处理替换交易
 * @param {Object} data - 交易数据
 */
async function processReplaceTransaction(data) {
  try {
    const psbt = new bitcoinjs.Psbt();
    
    // 获取我的输入
    const myInputs = await checkAndExtractMyInputs(data.hash, savedAddress);
    
    // 添加输入到PSBT
    addInputsToPsbt(psbt, myInputs);
    
    // 计算总输入金额
    const totalInputValue = myInputs.reduce((sum, input) => sum + input.value, 0);
    const totalFee = data.addsats;
    let outputAmount = totalInputValue - totalFee;
    
    // 如果余额不足，尝试获取更多UTXO
    if (outputAmount < 0) {
      const additionalUtxos = await getAdditionalUtxosIfNeeded(Math.abs(outputAmount));
      if (!additionalUtxos) {
        return;
      }
      
      // 添加额外UTXO到PSBT
      addInputsToPsbt(psbt, additionalUtxos);
      
      // 重新计算输出金额
      const newTotalInputValue = totalInputValue + additionalUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
      outputAmount = newTotalInputValue - totalFee;
    }
    
    // 添加输出
    if (outputAmount > 0) {
      psbt.addOutput({
        address: data.targetAddresses,
        value: Number(outputAmount)
      });
    }
    
    // 签名并广播交易
    await signAndBroadcastReplaceTransaction(psbt);
    
  } catch (error) {
    console.error('处理替换交易失败:', error);
    showNotification(error.message || '交易处理失败', 'error');
  }
}

/**
 * 添加输入到PSBT
 * @param {Object} psbt - PSBT对象
 * @param {Array} inputs - 输入数组
 */
function addInputsToPsbt(psbt, inputs) {
  inputs.forEach(input => {
    // 处理不同来源的输入对象
    let txid, vout;
    
    if (input.prev_txid && input.prev_vout !== undefined) {
      // 来自checkAndExtractMyInputs的对象
      txid = input.prev_txid;
      vout = input.prev_vout;
    } else if (input.txid && input.vout !== undefined) {
      // 来自getLargestConfirmedUTXO的对象
      txid = input.txid;
      vout = input.vout;
    } else {
      console.error('无效的输入对象:', input);
      throw new Error('输入对象缺少必要的txid或vout字段');
    }
    
    psbt.addInput({
      hash: txid,
      index: vout,
      sequence: 0xfffffffd, // 启用RBF
      witnessUtxo: {
        script: Buffer.from(bitcoinjs.address.toOutputScript(savedAddress).toString('hex'), 'hex'),
        value: Number(input.value)
      }
    });
  });
}

/**
 * 获取额外UTXO（如果需要）
 * @param {number} needAmount - 需要的金额
 * @returns {Promise<Array|null>} 额外UTXO数组或null
 */
async function getAdditionalUtxosIfNeeded(needAmount) {
  const needUtxo = await getLargestConfirmedUTXO(savedAddress, needAmount);
  
  if (!needUtxo) {
    showNotification("无法获取UTXO信息", 'error');
    return null;
  }
  
  if (!needUtxo.success) {
    showNotification(`余额不足，缺少：${(needUtxo.shortage / 1e8).toFixed(8)} BTC`, 'error');
    return null;
  }
  
  return needUtxo.utxos;
}

/**
 * 签名并广播替换交易
 * @param {Object} psbt - PSBT对象
 */
async function signAndBroadcastReplaceTransaction(psbt) {
  // 签名交易
  const signedPsbtHex = await window.unisat.signPsbt(psbt.toHex());
  const signedPsbt = bitcoinjs.Psbt.fromHex(signedPsbtHex);
  const rawTxHex = signedPsbt.extractTransaction().toHex();
  
  // 保存原始交易十六进制
  $('#rawTxHex').val(rawTxHex);
  
  // 广播交易
  const broadcastResult = await mempoolbroadcastTx(rawTxHex);
  
  // 隐藏模态框
  const modalElement = document.getElementById('transactionModal');
  const modal = bootstrap.Modal.getInstance(modalElement);
  modal.hide();
  
  // 处理广播结果
  if (broadcastResult.success) {
    showNotification(`广播成功：${broadcastResult.txid}`, 'success');
  } else {
    handleBroadcastFailure(broadcastResult);
  }
}

/**
 * 处理广播失败
 * @param {Object} result - 广播结果
 */
function handleBroadcastFailure(result) {
  // 尝试解析错误信息中的费用要求
  const feeMatch = result.message.match(/< (\d+\.?\d*)$/);
  let requiredFeeSat = 0;
  
  if (feeMatch) {
    const requiredFeeBTC = parseFloat(feeMatch[1]);
    requiredFeeSat = Math.ceil(requiredFeeBTC * 1e8);
  }
  
  const minValue = originalFee + requiredFeeSat;
  showNotification(`请保证总交易费用为：${minValue} sat`, 'error');
  
  // 更新滑块
  updateSliderWithNewFee(minValue);
}

/**
 * 更新滑块费用
 * @param {number} newFee - 新费用
 */
function updateSliderWithNewFee(newFee) {
  const slider = document.getElementById("addsats");
  const output = document.getElementById("addsatsValue");
  
  slider.value = newFee;
  output.textContent = newFee;
  slider.dispatchEvent(new Event('input'));
  updateRangeBackground(slider);
}
  

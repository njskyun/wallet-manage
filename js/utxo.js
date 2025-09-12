import { Buffer } from 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm';

// 获取保存的钱包地址
const savedAddress = localStorage.getItem('btcWalletAddress');

/**
 * 初始化UTXO选择器
 */
async function initializeUtxoSelector() {
  if (!isWalletConnected()) {
    showNotification('请先连接钱包', 'error');
    return;
  }

  if (!savedAddress) return;

  try {
    // 获取过滤后的UTXO列表
    const utxoList = await getFilteredUTXOs(savedAddress);
    
    if (utxoList && utxoList.length > 0) {
      // 添加自动匹配选项
      $('#utxoInput').append('<option value="-1">系统自动匹配</option>');
      
      // 填充UTXO选项
      utxoList.forEach(utxo => {
        const optionValue = `${utxo.txid}:${utxo.vout}:${utxo.value}`;
        const optionText = `${utxo.txid}:${utxo.vout} --> ${(utxo.value / 1e8).toFixed(8)} BTC`;
        
        $('#utxoInput').append(
          $('<option>')
            .val(optionValue)
            .text(optionText)
        );
      });
    }
  } catch (error) {
    console.error('初始化UTXO选择器失败:', error);
    showNotification('加载UTXO失败', 'error');
  }
}

$(document).ready(function() { 
  initializeUtxoSelector();
  


  // UTXO表单提交处理
  $('#utxoForm').on('submit', function(e) {
    e.preventDefault();
    handleUtxoFormSubmit();
  });
});

/**
 * 处理UTXO表单提交
 */
function handleUtxoFormSubmit() {
  // 检查钱包连接状态
  if (!isWalletConnected()) {
    showNotification('请先连接钱包', 'error');
    return;
  }
  
  // 获取表单数据
  const formData = {
    utxoInput: $('#utxoInput').val().trim(),
    transferAmount: $('#transferAmount').val().trim(),
    targetAddresses: $('#targetAddresses').val().trim(),
    feeRate: $('#feeRate').val().trim()
  };
  
  // 验证表单数据
  const validationResult = validateUtxoFormData(formData);
  if (!validationResult.isValid) {
    showNotification(validationResult.message, 'error');
    return;
  }
  
  // 解析目标地址
  const addresses = parseTargetAddresses(formData.targetAddresses);
  if (addresses.length === 0) {
    showNotification('请至少输入一个有效的目标地址', 'error');
    return;
  }
  
  // 显示交易确认模态框
  showTransactionModal('utxo', {
    utxoInput: formData.utxoInput,
    transferAmount: formData.transferAmount,
    targetAddresses: addresses,
    feeRate: formData.feeRate
  });
}

/**
 * 验证UTXO表单数据
 * @param {Object} formData - 表单数据
 * @returns {Object} 验证结果
 */
function validateUtxoFormData(formData) {
  const { utxoInput, transferAmount, targetAddresses, feeRate } = formData;
  
  if (!utxoInput || !transferAmount || !targetAddresses || !feeRate) {
    return {
      isValid: false,
      message: '请填写所有必填字段'
    };
  }
  
  // 验证转账金额
  const amount = parseFloat(transferAmount);
  if (isNaN(amount) || amount <= 0) {
    return {
      isValid: false,
      message: '请输入有效的转账金额'
    };
  }
  
  // 验证费率
  const rate = parseFloat(feeRate);
  if (isNaN(rate) || rate <= 0) {
    return {
      isValid: false,
      message: '请输入有效的费率'
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
  let detailsHtml = '';
  
  if (type === 'utxo') {
    detailsHtml = buildUtxoTransactionDetails(data);
  }
  
  // 设置模态框内容
  $('#transactionDetails').html(detailsHtml);
  
  // 设置确认按钮事件
  $('#confirmTransaction').off('click').on('click', function() {
    if (type === 'utxo') {
      processUtxoTransaction(data);
    }
  });
  
  // 显示模态框
  const transactionModal = new bootstrap.Modal(document.getElementById('transactionModal'));
  transactionModal.show();
}

/**
 * 构建UTXO交易详情HTML
 * @param {Object} data - 交易数据
 * @returns {string} HTML字符串
 */
function buildUtxoTransactionDetails(data) {
  const amount = parseFloat(data.transferAmount);
  const numAddresses = data.targetAddresses.length;
  const totalAmount = amount * numAddresses;
  
  return `
    <div class="transaction-preview">
      <h3 class="mb-3">交易详情</h3>
      
      <div class="transaction-detail-item">
        <span class="label">总发送金额:</span>
        <span class="value">${totalAmount.toFixed(8)} BTC</span>
      </div>
      
      <div class="transaction-detail-item">
        <span class="label">每地址金额:</span>
        <span class="value">${amount.toFixed(8)} BTC</span>
      </div>
      
      <div class="transaction-detail-item">
        <span class="label">接收地址数量:</span>
        <span class="value">${numAddresses} 个地址</span>
      </div>
      
      <div class="transaction-detail-item">
        <span class="label">费率:</span>
        <span class="value">${data.feeRate} sat/vB</span>
      </div>
      
      <div class="warning mt-3">
        <i class="fas fa-exclamation-triangle me-2"></i>
        请仔细确认所有交易详情。
      </div>
    </div>
  `;
}

/**
 * 处理UTXO交易
 * @param {Object} data - 交易数据
 */
async function processUtxoTransaction(data) {
  try {
    // 转换金额为聪
    const amountInSats = Math.round(parseFloat(data.transferAmount) * 1e8);
    
    // 构建输出列表
    const outputs = data.targetAddresses.map(address => ({
      address: address.trim(),
      value: amountInSats
    }));

    const psbt = new bitcoinjs.Psbt();
    
    // 选择UTXO
    const selectedUtxos = await selectUtxosForTransaction(data, amountInSats);
    if (!selectedUtxos.length) {
      return;
    }
    
    // 添加输入到PSBT
    addInputsToPsbt(psbt, selectedUtxos);
    
    // 计算找零
    const changeAmount = calculateChange(
      selectedUtxos, 
      data.targetAddresses.length * amountInSats, 
      data.feeRate, 
      data.targetAddresses.length
    );
    
    if (changeAmount < 0) {
      showNotification(`余额不足，缺少：${(changeAmount / 1e8).toFixed(8)} BTC`, 'error');
      return;
    }
    
    // 添加找零输出
    if (changeAmount > 0) {
      psbt.addOutput({
        address: savedAddress,
        value: changeAmount
      });
    }
    
    // 添加支付输出
    outputs.forEach(output => {
      psbt.addOutput({
        address: output.address,
        value: output.value
      });
    });
    
    // 签名并广播交易
    await signAndBroadcastTransaction(psbt);
    
  } catch (error) {
    console.error('处理UTXO交易失败:', error);
    showNotification(error.message || '交易处理失败', 'error');
  }
}

/**
 * 选择UTXO用于交易
 * @param {Object} data - 交易数据
 * @param {number} amountInSats - 金额（聪）
 * @returns {Promise<Array>} 选中的UTXO数组
 */
async function selectUtxosForTransaction(data, amountInSats) {
  if (data.utxoInput === "-1") {
    // 自动选择UTXO
    const utxos = await getFilteredUTXOs(savedAddress);
    const selectedUtxos = selectUtxosWithChange(
      utxos, 
      data.targetAddresses.length * amountInSats, 
      data.feeRate
    );
    
    if (!selectedUtxos.length) {
      showNotification("余额不足", 'error');
      return [];
    }
    
    return selectedUtxos;
  } else {
    // 使用指定的UTXO
    const selectedUtxos = splitHashString(data.utxoInput);
    if (!selectedUtxos.length) {
      showNotification('请正确选择UTXO', 'error');
      return [];
    }
    
    return selectedUtxos;
  }
}

/**
 * 添加输入到PSBT
 * @param {Object} psbt - PSBT对象
 * @param {Array} utxos - UTXO数组
 */
function addInputsToPsbt(psbt, utxos) {
  utxos.forEach(utxo => {
    psbt.addInput({
      hash: utxo.txid,
      index: parseInt(utxo.vout, 10),
      sequence: 0xfffffffd, // 启用RBF
      witnessUtxo: {
        script: Buffer.from(bitcoinjs.address.toOutputScript(savedAddress).toString('hex'), 'hex'),
        value: parseInt(utxo.value, 10)
      }
    });
  });
}

/**
 * 签名并广播交易
 * @param {Object} psbt - PSBT对象
 */
async function signAndBroadcastTransaction(psbt) {
  // 签名交易
  const signedPsbtHex = await window.unisat.signPsbt(psbt.toHex());
  const signedPsbt = bitcoinjs.Psbt.fromHex(signedPsbtHex);
  const rawTxHex = signedPsbt.extractTransaction().toHex();
  
  // 保存原始交易十六进制
  $("#utxo-rawTxHex").val(rawTxHex);
  
  // 广播交易
  const broadcastResult = await mempoolbroadcastTx(rawTxHex);
  
  // 隐藏模态框
  const modalElement = document.getElementById('transactionModal');
  const modal = bootstrap.Modal.getInstance(modalElement);
  modal.hide();
  
  // 显示结果
  if (broadcastResult.success) {
    showNotification(`广播成功：${broadcastResult.txid}`, 'success');
  } else {
    showNotification(`广播失败：${broadcastResult.message}`, 'error');
  }
}

/**
 * 添加交易模态框样式
 */
function addTransactionModalStyles() {
  const styles = `
    .transaction-detail-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .transaction-detail-item .label {
      color: var(--text-secondary);
      font-weight: 500;
    }
    
    .transaction-detail-item .value {
      font-weight: 600;
      font-family: monospace;
    }
    
    .address-list {
      max-height: 150px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      padding: 10px;
    }
    
    .address-item {
      display: flex;
      margin-bottom: 5px;
      font-family: monospace;
      font-size: 0.9rem;
    }
    
    .address-number {
      color: var(--accent-color);
      margin-right: 10px;
      min-width: 20px;
    }
    
    .warning {
      color: var(--warning-color);
      font-size: 0.9rem;
      padding: 10px;
      background: rgba(255, 193, 7, 0.1);
      border-radius: 4px;
    }
  `;
  
  $('<style>').text(styles).appendTo('head');
}

// 页面加载完成后添加样式
$(document).ready(function() {
  addTransactionModalStyles();
});

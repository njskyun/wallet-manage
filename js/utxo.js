import { Buffer } from 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm';

const savedAddress = localStorage.getItem('btcWalletAddress');


$(document).ready(function() { 
  (async function populateUtxoSelect() {
    // 1. 取出保存的地址
    if (!isWalletConnected()) {
      showNotification('请先连接钱包', 'error');
      return;
    }

    if (!savedAddress) return;
  
    // 2. 等待异步函数执行
    const utxoInputOption = await getFilteredUTXOs(savedAddress);
    
    if (utxoInputOption) {
      $('#utxoInput').append('<option value="-1">系统自动匹配</option>'); 
    }
    // 3. 遍历填充 <select id="utxoInput">
    utxoInputOption.forEach(item => {
      $('#utxoInput').append(
        $('<option>')
          .val(`${item.txid}:${item.vout}:${item.value}`)
          .text(`${item.txid}:${item.vout} -->   ${item.value / 1e8}  Btc`)
      );
    });
  })();
  


  // UTXO form submission
  $('#utxoForm').on('submit', function(e) {
    e.preventDefault();
    
    // Check if wallet is connected
    if (!isWalletConnected()) {
      showNotification('请先连接钱包', 'error');
      return;
    }
    
    // Get form values
    const utxoInput = $('#utxoInput').val().trim();
    const transferAmount = $('#transferAmount').val().trim();
    const targetAddresses = $('#targetAddresses').val().trim();
    const feeRate = $('#feeRate').val().trim();
    
    // Basic validation
    if (!utxoInput || !transferAmount || !targetAddresses || !feeRate) {
      showNotification('请填写所有必填字段', 'error');
      return;
    }
    
    // Parse target addresses
    const addresses = parseTargetAddresses(targetAddresses);
    if (addresses.length === 0) {
      showNotification('请至少输入一个有效的目标地址', 'error');
      return;
    }
    
    // Show transaction confirmation modal
    showTransactionModal('utxo', {
      utxoInput,
      transferAmount,
      targetAddresses: addresses,
      feeRate
    });
  });
});
  
// Show transaction confirmation modal
function showTransactionModal(type, data) {
  let detailsHtml = '';
  let totalAmount = 0;
  
  if (type === 'utxo') {
    // Calculate total amount
    const amount = parseFloat(data.transferAmount);
    const numAddresses = data.targetAddresses.length;
    totalAmount = amount * numAddresses;
    
    // Build HTML for transaction details
    detailsHtml = `
      <div class="transaction-preview">
        <h3 class="mb-3">交易详情</h3>
   
        <div class="transaction-detail-item">
          <span class="label">总发送金额:</span>
          <span class="value">${totalAmount} BTC</span>
        </div>
        
        <div class="transaction-detail-item">
          <span class="label">每地址金额:</span>
          <span class="value">${data.transferAmount} BTC</span>
        </div>
        
        <div class="transaction-detail-item">
          <span class="label">接收地址数量:</span>
          <span class="value">${data.targetAddresses.length} 个地址</span>
        </div>
        
        <div class="transaction-detail-item">
          <span class="label">费率:</span>
          <span class="value">${data.feeRate} sat/vB</span>
        </div>
         
    `;
     
    detailsHtml += ` 
        <div class="warning mt-3">
          <i class="fas fa-exclamation-triangle me-2"></i>
          请仔细确认所有交易详情。
        </div>
      </div>
    `;
  }
  
  // Set modal content and show it
  $('#transactionDetails').html(detailsHtml);
  
  // Set up confirm button
  $('#confirmTransaction').off('click').on('click', function() {
    if (type === 'utxo') {
      processUtxoTransaction(data);
    }
  });
  
  // Show the modal
  const transactionModal = new bootstrap.Modal(document.getElementById('transactionModal'));
  transactionModal.show();
}

// Process UTXO transaction
async function processUtxoTransaction(data) { 
  const amount = Math.round(parseFloat(data.transferAmount) * 1e8); // 转换为聪并四舍五入 
  // 构建输出列表
  const outputs = data.targetAddresses.map(address => ({
      address: address.trim(),
      value: amount
  }));

  const psbt = new bitcoinjs.Psbt();

  try {  
      let bestUtxos = []

      if (data.utxoInput == "-1") {
        const utxos = await getFilteredUTXOs(savedAddress);
        bestUtxos = selectUtxosWithChange(utxos, data.targetAddresses.length * amount, data.feeRate); 
        if (!bestUtxos.length) {
          showNotification("余额不足", 'error');
          return
        }
      } else { 
        bestUtxos = splitHashString(data.utxoInput);
        if (!bestUtxos.length) {
          showNotification('请正确选择 UTXO', 'error');
          return
        }
      } 
      
      let payAmount = 0;
      // 将每个选中的 UTXO 添加为输入
      bestUtxos.forEach(utxo => {
        payAmount = payAmount + parseInt(utxo.value)
        //添加所有 UTXO 作为输入 
        psbt.addInput({
          hash: utxo.txid,
          index: parseInt(utxo.vout),
          sequence: 0xfffffffd,  // 启用 RBF
          witnessUtxo: {
              script: Buffer.from(bitcoinjs.address.toOutputScript(savedAddress).toString('hex'), 'hex'),  //脚本公钥，在https://mempool.fractalbitcoin.io网站找
              value: parseInt(utxo.value)
          }
        });
      });
      
      const ts_self = calculateChange(bestUtxos, data.targetAddresses.length * amount, data.feeRate, data.targetAddresses.length)
 
      if (ts_self < 0) {    
        showNotification("余额不足, 缺少：" + ts_self / 1e8, 'error');  
        return;
      }
      
      //计算剩余转给自己
      if (ts_self > 0) {
          psbt.addOutput({
              address: savedAddress,  // 接收方地址
              value: ts_self,  // 输出金额（聪）
          });  
      }
 
      //逐个添加输出，添加调试信息
      outputs.forEach((output, index) => {
          psbt.addOutput({
              address: output.address,  // 接收方地址
              value: output.value,  // 输出金额（聪）
          }); 
      }); 
 
      //签名
      const signedPsbtHex = await window.unisat.signPsbt(psbt.toHex());

      const signPsbtHex = bitcoinjs.Psbt.fromHex(signedPsbtHex);
      const rawTxHex = signPsbtHex.extractTransaction().toHex();
      $("#utxo-rawTxHex").val(rawTxHex);

      //广播交易
      const tx = await mempoolbroadcastTx(rawTxHex);
      // let res = await window.unisat.pushPsbt(signedPsbtHex); 
      
      // Hide modal
      const modalElement = document.getElementById('transactionModal');
      const modal = bootstrap.Modal.getInstance(modalElement);
      modal.hide();
      
      // Show processing notification 
      // Show processing notification 
      if (tx.success) {
          showNotification('广播成功： ' + tx.txid, 'success');
      } else {
          showNotification('广播失败： ' + tx.message, 'error');
      } 
  } catch (err) {     
      console.error('❗ Non-Error exception caught:', err);

      showNotification(err.message, 'error');
  }
}

// Add some CSS for the transaction modal
$(document).ready(function() {
  $('<style>')
    .text(`
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
    `)
    .appendTo('head');
});

import { Buffer } from 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm';

const savedAddress = localStorage.getItem('btcWalletAddress');
 
$(document).ready(function() { 
  
  $('#taddr').val(savedAddress);

  (async function populateUtxoSelect() {
    // 1. 取出保存的地址
    if (!isWalletConnected()) {
      showNotification('请先连接钱包', 'error');
      return;
    }

    if (!savedAddress) return;  
  })();
  



  
  const slider = document.getElementById("addsats");
  const output = document.getElementById("addsatsValue");

  // 初始化显示
  slider.value = 0;
  output.textContent = 0;

  // 拖动滑块实时更新显示
  slider.addEventListener("input", () => {
    output.textContent = slider.value;
  });

  // hash 输入触发计算
  document.getElementById("hash").addEventListener("input", async function (e) {
    const txid = e.target.value.trim();
    if (!txid) return;

    try {
      const feeA = await getTxfee(txid);
      const totalFee = await getOutspendsFee(txid);

      const initialValue = Math.floor(feeA + totalFee);

      // 设置滑块初始值
      slider.value = initialValue;
      output.textContent = initialValue;

      // 可选：如果计算值大于当前 max，把 max 动态调大
      if (initialValue > parseInt(slider.max)) {
        slider.max = initialValue;
      }

    } catch (err) {
      console.error("请求或计算出错：", err);
    }
  });
  

  // UTXO form submission
  $('#utxoForm').on('submit', function(e) {
    e.preventDefault();
    
    // Check if wallet is connected
    if (!isWalletConnected()) {
      showNotification('请先连接钱包', 'error');
      return;
    }
    
    // Get form values
    const hash = $('#hash').val().trim();
    const taddr = $('#taddr').val().trim(); 
    const addsats = Math.ceil($('#addsats').val().trim());

    // Basic validation 
    if (!hash || !taddr || !addsats) {
      showNotification('请填写所有必填字段', 'error');
      return;
    }
      
    // Show transaction confirmation modal
    showTransactionModal('replace', {
      hash, 
      targetAddresses: taddr,
      addsats: addsats
    });
  });
});
  
// Show transaction confirmation modal
function showTransactionModal(type, data) { 
  // Set up confirm button
  $('#confirmTransaction').off('click').on('click', function() {
    processUtxoTransaction(data);
  });
  
  // Show the modal
  const transactionModal = new bootstrap.Modal(document.getElementById('transactionModal'));

  
  $("#confirmaddr").text(data.targetAddresses);
  transactionModal.show();
}

// Process UTXO transaction
async function processUtxoTransaction(data) {
  const psbt = new bitcoinjs.Psbt();

  try {   
      const largeUtxo = await getLargestConfirmedUTXO(savedAddress);
      console.log('largeUtxo');
      console.log(largeUtxo);

      
      let largeUtxoValue = 0;

      // if (largeUtxo) {
      //   largeUtxoValue = largeUtxo.value;
      //   psbt.addInput({
      //       hash: largeUtxo.txid,
      //       index: largeUtxo.vout,
      //       sequence: 0xfffffffd, // 启用 RBF
      //       witnessUtxo: {
      //         script: Buffer.from(bitcoinjs.address.toOutputScript(savedAddress).toString('hex'), 'hex'),  
      //         value: Number(largeUtxo.value)
      //       }
      //   });
      // }


      const myInputs = await checkAndExtractMyInputs(data.hash, savedAddress);
      
      // 将每个选中的 UTXO 添加为输入
      for (const utxo of myInputs) {
        psbt.addInput({
          hash: utxo.prev_txid,
          index: utxo.prev_vout,
          sequence: 0xfffffffd, // 启用 RBF
          witnessUtxo: {
            script: Buffer.from(bitcoinjs.address.toOutputScript(savedAddress).toString('hex'), 'hex'),  
            value: Number(utxo.value)
          }
        });
      } 
       
      const totalInputValue = myInputs.reduce((sum, u) => sum + u.value, 0);
 
      const totalFee =  data.addsats;
      const tomoney = totalInputValue + largeUtxoValue - totalFee;
      
      if (tomoney < 0) {
        showNotification("余额不足, 缺少：" + tomoney / 1e8, 'error');  
        return;
      }
      
      if (tomoney > 0) {
          psbt.addOutput({
              address: data.targetAddresses,  // 接收方地址
              value: Number(tomoney),  // 输出金额（聪）
          });  
      }
  
      
      //签名
      const signedPsbtHex = await window.unisat.signPsbt(psbt.toHex());
  
     
      const signPsbtHex = bitcoinjs.Psbt.fromHex(signedPsbtHex);
      // signPsbtHex.finalizeAllInputs();
      const rawTxHex = signPsbtHex.extractTransaction().toHex();
      $('#rawTxHex').val(rawTxHex);

      //广播交易
      let res = await window.unisat.pushPsbt(signedPsbtHex);  
      
      // Hide modal
      const modalElement = document.getElementById('transactionModal');
      const modal = bootstrap.Modal.getInstance(modalElement);
      modal.hide();
      
      // Show processing notification 
      showNotification('交易已提交等待确认...', 'success');

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
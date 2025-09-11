// BRC20 铭文管理功能
class BRC20Manager {
  constructor() {
    this.walletAddress = null;
    this.inscriptions = [];
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupFeeSlider();
    this.loadWalletInfo();
  }

  setupEventListeners() {
    // 刷新铭文按钮
    document.getElementById('refreshInscriptions').addEventListener('click', () => {
      this.loadInscriptions();
    });

    // 铸造表单提交
    document.getElementById('mintForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleMintSubmit();
    });

    // 确认交易按钮
    document.getElementById('confirmTransaction').addEventListener('click', () => {
      this.confirmMintTransaction();
    });

    // 铭文类型变化
    document.getElementById('mintType').addEventListener('change', (e) => {
      this.updateContentPlaceholder(e.target.value);
    });
  }

  setupFeeSlider() {
    const feeSlider = document.getElementById('mintFee');
    const feeRateDisplay = document.getElementById('mintFeeRate');
    const feeAmountDisplay = document.getElementById('mintFeeAmount');

    feeSlider.addEventListener('input', (e) => {
      const rate = e.target.value;
      feeRateDisplay.textContent = rate;
      
      // 估算交易费用 (假设交易大小约250字节)
      const estimatedSize = 250;
      const feeAmount = rate * estimatedSize;
      feeAmountDisplay.textContent = feeAmount;
    });

    // 初始化显示
    feeRateDisplay.textContent = feeSlider.value;
    feeAmountDisplay.textContent = feeSlider.value * 250;
  }

  updateContentPlaceholder(type) {
    const contentTextarea = document.getElementById('mintContent');
    const placeholders = {
      'text': '请输入文本内容...',
      'image': '请输入图片的base64编码或URL...',
      'json': '{"name": "example", "description": "这是一个JSON铭文"}',
      'html': '<html><body><h1>Hello World</h1></body></html>'
    };
    
    contentTextarea.placeholder = placeholders[type] || '请输入铭文内容...';
  }

  loadWalletInfo() {
    // 检查是否有已连接的钱包
    const walletAddress = localStorage.getItem('btcWalletAddress');
    if (walletAddress) {
      this.walletAddress = walletAddress;
      this.loadInscriptions();
    } else {
      this.showNoWalletMessage();
    }
  }

  showNoWalletMessage() {
    const container = document.getElementById('inscriptionsList');
    container.innerHTML = `
      <div class="text-center py-5">
        <i class="fas fa-wallet fa-3x text-muted mb-3"></i>
        <h5 class="text-muted">请先连接钱包</h5>
        <p class="text-muted">连接钱包后即可查看和管理您的BRC20铭文</p>
      </div>
    `;
  }

  async loadInscriptions() {
    if (!this.walletAddress) {
      this.showNoWalletMessage();
      return;
    }

    const container = document.getElementById('inscriptionsList');
    container.innerHTML = `
      <div class="text-center py-4">
        <div class="loading-spinner me-2"></div>
        <span class="text-muted">正在加载铭文数据...</span>
      </div>
    `;

    try {
      // 模拟从API获取铭文数据
      // 在实际应用中，这里应该调用真实的BRC20 API
      await this.fetchInscriptionsFromAPI();
      this.displayInscriptions();
    } catch (error) {
      console.error('加载铭文失败:', error);
      this.showErrorMessage('加载铭文失败，请稍后重试');
    }
  }

  async fetchInscriptionsFromAPI() {
    try {
      // 使用 Ordinals API 获取铭文数据
      // 这里使用多个API源来提高成功率
      const apis = [
        `https://api.hiro.so/ordinals/v1/inscriptions?address=${this.walletAddress}&limit=10`
      ];

      let inscriptions = [];
      let lastError = null;

      // 尝试每个API
      for (const apiUrl of apis) {
        try {          
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Bitcoin-Wallet-Manager/1.0'
            },
            timeout: 10000 // 10秒超时
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          
      // 解析不同API的响应格式
      if (data.results || data.inscriptions || Array.isArray(data)) {
        inscriptions = await this.parseInscriptionsData(data); 
        break;
      }
        } catch (error) {
          console.warn(`API ${apiUrl} 失败:`, error.message);
          lastError = error;
          continue;
        }
      }

      // 如果所有API都失败，使用备用方案
  
      this.inscriptions = inscriptions;
      
    } catch (error) {
      console.error('获取铭文数据失败:', error);
      throw new Error('无法获取铭文数据，请检查网络连接或稍后重试');
    }
  }

  async parseInscriptionsData(data) {
    const inscriptions = [];
    
    // 处理Hiro API的响应格式
    const items = data.results || data.inscriptions || data || [];
    
    for (const item of items) {
      try {
        const inscription = {
          id: item.id,
          number: item.number,
          type: this.detectInscriptionType(item.mime_type),
          content: '', // 初始为空，稍后加载
          timestamp: item.timestamp || item.genesis_timestamp,
          txid: item.tx_id || item.genesis_tx_id,
          status: 'confirmed', // Hiro API返回的都是已确认的
          output: item.output,
          value: item.value,
          genesis_fee: item.genesis_fee,
          mime_type: item.mime_type,
          content_type: item.content_type,
          content_length: item.content_length,
          location: item.location,
          sat_ordinal: item.sat_ordinal,
          sat_rarity: item.sat_rarity
        };
        
        // 自动加载铭文内容
        try {
          inscription.content = await this.fetchInscriptionContent(inscription);
        } catch (error) {
          console.warn(`加载铭文 ${item.id} 内容失败:`, error);
          inscription.content = '内容加载失败';
        }
        
        inscriptions.push(inscription);
      } catch (error) {
        console.warn('解析铭文数据失败:', error, item);
      }
    }
    
    return inscriptions;
  }

  async fetchInscriptionContent(inscription) {
    try {
      // 先获取铭文详细信息  
      // 根据MIME类型决定如何获取内容
      if (inscription.mime_type?.startsWith('text/') || inscription.mime_type?.startsWith('application/json')) {
        // 文本类型，直接获取内容
        const contentResponse = await fetch(`https://api.hiro.so/ordinals/v1/inscriptions/${inscription.id}/content`);
        
        if (!contentResponse.ok) {
          throw new Error(`获取内容失败: ${contentResponse.status}`);
        }
        
        const content = await contentResponse.text();
        
        // 如果是JSON，尝试格式化
        if (inscription.mime_type?.startsWith('application/json')) {
          try {
            const parsed = JSON.parse(content);
            return JSON.stringify(parsed, null, 2);
          } catch (e) {
            return content;
          }
        }
        
        return content;
      } else if (inscription.mime_type?.startsWith('image/')) {
        // 图片类型，返回图片信息
        return `[图片内容 - ${inscription.mime_type}, 大小: ${inscription.content_length} 字节]`;
      } else {
        // 其他类型
        return `[${inscription.mime_type} 内容, 大小: ${inscription.content_length} 字节]`;
      }
      
    } catch (error) {
      console.error('获取铭文内容失败:', error);
      return '内容加载失败';
    }
  }

  detectInscriptionType(mimeType) {
    if (!mimeType) return 'unknown';
    
    // 根据MIME类型判断铭文类型
    if (mimeType.startsWith('text/plain')) {
      return 'text';
    } else if (mimeType.startsWith('application/json')) {
      return 'json';
    } else if (mimeType.startsWith('text/html')) {
      return 'html';
    } else if (mimeType.startsWith('image/')) {
      return 'image';
    } else if (mimeType.startsWith('text/')) {
      return 'text';
    } else if (mimeType.startsWith('application/')) {
      return 'json';
    } else {
      return 'unknown';
    }
  }

  async fetchFromMempoolSpace() {
    try {
      // 使用 mempool.space API 作为备用方案
      const response = await fetch(`https://mempool.space/api/address/${this.walletAddress}/txs`);
      
      if (!response.ok) {
        throw new Error(`Mempool API 错误: ${response.status}`);
      }
      
      const txs = await response.json();
      const inscriptions = [];
      
      // 从交易中提取铭文信息
      for (const tx of txs.slice(0, 50)) { // 限制处理前50个交易
        try {
          // 检查交易是否包含铭文
          const txResponse = await fetch(`https://mempool.space/api/tx/${tx.txid}`);
          const txData = await txResponse.json();
          
          // 这里需要根据实际的铭文检测逻辑来解析
          // 简化版本：检查输出脚本中是否包含铭文标识
          if (this.hasInscription(txData)) {
            inscriptions.push({
              id: `inscription_${tx.txid.slice(0, 8)}`,
              type: 'unknown',
              content: '铭文内容需要进一步解析',
              timestamp: tx.status.block_time * 1000,
              txid: tx.txid,
              status: tx.status.confirmed ? 'confirmed' : 'pending'
            });
          }
        } catch (error) {
          console.warn(`处理交易 ${tx.txid} 失败:`, error);
        }
      }
      
      return inscriptions;
    } catch (error) {
      console.error('Mempool 备用方案失败:', error);
      return [];
    }
  }

  hasInscription(txData) {
    // 简化的铭文检测逻辑
    // 实际应用中需要更复杂的解析
    return txData.vout && txData.vout.some(output => 
      output.scriptpubkey_type === 'op_return' || 
      (output.scriptpubkey_asm && output.scriptpubkey_asm.includes('OP_PUSH'))
    );
  }

  displayInscriptions() {
    const container = document.getElementById('inscriptionsList');
    
    if (this.inscriptions.length === 0) {
      container.innerHTML = `
        <div class="text-center py-5">
          <i class="fas fa-coins fa-3x text-muted mb-3"></i>
          <h5 class="text-muted">暂无铭文</h5>
          <p class="text-muted">您还没有铸造任何BRC20铭文</p>
          <button class="btn btn-primary mt-3" onclick="document.getElementById('mint-tab').click()">
            <i class="fas fa-plus-circle me-2"></i>开始铸造
          </button>
        </div>
      `;
      return;
    }

    const inscriptionsHTML = this.inscriptions.map(inscription => `
      <div class="inscription-card">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <h6 class="mb-1">
              <i class="fas fa-${this.getTypeIcon(inscription.mime_type)} me-2"></i>
              ${this.getTypeName(inscription.mime_type)} 
            </h6>
             <small class="text-muted"><a href="https://uniscan.cc/inscription/${inscription.id}" target="_blank" class="text-warning">${inscription.id}</a> </small>
          </div>
          <div class="text-end">
            <span class="badge bg-success">${inscription.status}</span>
            <small class="text-muted d-block">${this.formatTimestamp(inscription.timestamp)}</small>
          </div>
        </div>
        
        <div class="inscription-content">
          ${this.formatContent(inscription.content, inscription.type)}
        </div>
        
        <div class="mt-2">
          <small class="text-muted">
            <i class="fas fa-hashtag me-1"></i>
            交易Hash: <span class="text-light">${inscription.txid}</span>
          </small>
        </div>
      </div>
    `).join('');

    container.innerHTML = inscriptionsHTML;
  }

  getTypeIcon(mimeType) { 
    if (!mimeType) return 'file';
    
    // 根据MIME类型包含匹配
    if (mimeType.includes('text/plain')) {
      return 'text';
    } else if (mimeType.includes('application/json')) {
      return 'text';
    } else if (mimeType.includes('text/html')) {
      return 'html';
    } else if (mimeType.includes('image/')) {
      return 'image';
    } else if (mimeType.includes('text/')) {
      return 'file-text';
    } else if (mimeType.includes('application/')) {
      return 'cog';
    } else if (mimeType.includes('video/')) {
      return 'video';
    } else if (mimeType.includes('audio/')) {
      return 'music';
    } else {
      return 'file';
    }
  }

  formatContent(content, type) {
    if (!content) {
      return '<span class="text-muted">无内容</span>';
    }
    
    if (type == 'text') { 
        return `<pre class="mb-0">${this.escapeHtml(content)}</pre>`; 
    }
    
    if (type == 'html') { 
      const escaped = this.escapeHtml(content);
      return `<pre class="mb-0">${escaped}</pre>`;
    }
    
     if (type == 'image') {
       return `<div class="text-light">${content}</div>`;
     }
     
     if (type == 'video') {
       return `<div class="text-light">${content}</div>`;
     }
      
     if (type == 'audio') {
       return `<div class="text-light">${content}</div>`;
     }
    
    // 默认文本显示
    if (content.length > 300) {
      return `<pre class="mb-0">${this.escapeHtml(content.substring(0, 300))}...</pre>`;
    }
    
    return `<pre class="mb-0">${this.escapeHtml(content)}</pre>`;
  }

  getTypeName(mimeType) {
    if (!mimeType) return '未知';
    
    // 根据MIME类型包含匹配
    if (mimeType.includes('text/plain')) {
      return '文本';
    } else if (mimeType.includes('application/json')) {
      return 'JSON';
    } else if (mimeType.includes('text/html')) {
      return 'HTML';
    } else if (mimeType.includes('image/')) {
      return '图片';
    } else if (mimeType.includes('text/')) {
      return '文本';
    } else if (mimeType.includes('application/')) {
      return '应用';
    } else if (mimeType.includes('video/')) {
      return '视频';
    } else if (mimeType.includes('audio/')) {
      return '音频';
    } else {
      return '未知';
    }
  }

  formatInscriptionContent(inscription) {
    // 显示铭文的基本信息，因为Hiro API需要额外的调用来获取内容
    const info = [];
    
    if (inscription.number) {
      info.push(`铭文编号: ${inscription.number}`);
    }
    
    if (inscription.mime_type) {
      info.push(`类型: ${inscription.mime_type}`);
    }
    
    if (inscription.content_length) {
      info.push(`大小: ${inscription.content_length} 字节`);
    }
    
    if (inscription.value) {
      info.push(`价值: ${inscription.value} sats`);
    }
    
    if (inscription.sat_rarity) {
      info.push(`稀有度: ${inscription.sat_rarity}`);
    }
    
    if (inscription.location) {
      info.push(`位置: ${inscription.location}`);
    }
    
    return `
      <div class="inscription-info">
        <div class="mb-2">
          <button class="btn btn-sm btn-outline-primary" onclick="brc20Manager.loadInscriptionContent('${inscription.id}')">
            <i class="fas fa-download me-1"></i>加载内容
          </button>
        </div>
        <div class="inscription-details">
          ${info.map(item => `<div class="mb-1"><small class="text-muted">${item}</small></div>`).join('')}
        </div>
        <div id="content-${inscription.id}" class="inscription-actual-content mt-2" style="display: none;">
          <div class="loading-spinner me-2"></div>
          <span class="text-muted">正在加载内容...</span>
        </div>
      </div>
    `;
  }

  async loadInscriptionContent(inscriptionId) {
    const contentDiv = document.getElementById(`content-${inscriptionId}`);
    if (!contentDiv) return;
    
    try {
      // 使用Hiro API获取铭文内容
      const response = await fetch(`https://api.hiro.so/ordinals/v1/inscriptions/${inscriptionId}`);
      
      if (!response.ok) {
        throw new Error(`获取内容失败: ${response.status}`);
      }
      
      const data = await response.json();
      
      // 显示内容
      let contentHtml = '';
      
      if (data.mime_type?.startsWith('text/')) {
        // 文本内容
        const textContent = data.metadata || '无内容';
        contentHtml = `<pre class="mb-0">${this.escapeHtml(textContent)}</pre>`;
      } else if (data.mime_type?.startsWith('image/')) {
        // 图片内容
        contentHtml = `<img src="https://api.hiro.so/ordinals/v1/inscriptions/${inscriptionId}/content" style="max-width: 100%; height: auto;" alt="铭文图片">`;
      } else if (data.mime_type?.startsWith('application/json')) {
        // JSON内容
        try {
          const jsonContent = JSON.parse(data.metadata || '{}');
          contentHtml = `<pre class="mb-0">${JSON.stringify(jsonContent, null, 2)}</pre>`;
        } catch (e) {
          contentHtml = `<pre class="mb-0">${this.escapeHtml(data.metadata || '')}</pre>`;
        }
      } else {
        // 其他类型
        contentHtml = `<div class="text-muted">内容类型: ${data.mime_type}</div>`;
      }
      
      contentDiv.innerHTML = contentHtml;
      contentDiv.style.display = 'block';
      
    } catch (error) {
      console.error('加载铭文内容失败:', error);
      contentDiv.innerHTML = `<div class="text-danger">加载失败: ${error.message}</div>`;
      contentDiv.style.display = 'block';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  }

  showErrorMessage(message) {
    const container = document.getElementById('inscriptionsList');
    container.innerHTML = `
      <div class="text-center py-4">
        <i class="fas fa-exclamation-triangle fa-2x text-warning mb-3"></i>
        <h5 class="text-warning">加载失败</h5>
        <p class="text-muted">${message}</p>
        <button class="btn btn-outline-primary" onclick="brc20Manager.loadInscriptions()">
          <i class="fas fa-redo me-2"></i>重试
        </button>
      </div>
    `;
  }

  handleMintSubmit() {
    const type = document.getElementById('mintType').value;
    const content = document.getElementById('mintContent').value;
    const feeRate = document.getElementById('mintFee').value;

    if (!type || !content) {
      this.showNotification('请填写完整的铭文信息', 'warning');
      return;
    }

    // 验证内容格式
    if (!this.validateContent(content, type)) {
      this.showNotification('铭文内容格式不正确', 'error');
      return;
    }

    // 显示确认模态框
    this.showMintConfirmation(type, content, feeRate);
  }

  validateContent(content, type) {
    switch (type) {
      case 'json':
        try {
          JSON.parse(content);
          return true;
        } catch (e) {
          return false;
        }
      case 'html':
        return content.includes('<') && content.includes('>');
      default:
        return content.length > 0;
    }
  }

  showMintConfirmation(type, content, feeRate) {
    document.getElementById('confirmType').textContent = `${this.getTypeName(type)} 铭文铸造`;
    document.getElementById('confirmContent').innerHTML = this.formatContent(content, type);
    document.getElementById('confirmFee').textContent = feeRate * 250;

    const modal = new bootstrap.Modal(document.getElementById('transactionModal'));
    modal.show();
  }

  async confirmMintTransaction() {
    const confirmBtn = document.getElementById('confirmTransaction');
    const originalText = confirmBtn.innerHTML;
    
    confirmBtn.innerHTML = '<div class="loading-spinner me-2"></div>铸造中...';
    confirmBtn.disabled = true;

    try {
      // 模拟铸造过程
      await this.simulateMintProcess();
      
      // 关闭模态框
      const modal = bootstrap.Modal.getInstance(document.getElementById('transactionModal'));
      modal.hide();
      
      // 显示成功消息
      this.showNotification('铭文铸造成功！', 'success');
      
      // 刷新铭文列表
      setTimeout(() => {
        this.loadInscriptions();
      }, 1000);
      
      // 重置表单
      document.getElementById('mintForm').reset();
      
    } catch (error) {
      console.error('铸造失败:', error);
      this.showNotification('铸造失败，请重试', 'error');
    } finally {
      confirmBtn.innerHTML = originalText;
      confirmBtn.disabled = false;
    }
  }

  async simulateMintProcess() {
    try {
      const type = document.getElementById('mintType').value;
      const content = document.getElementById('mintContent').value;
      const feeRate = parseInt(document.getElementById('mintFee').value);
      
      // 获取钱包私钥（实际应用中应该更安全地处理）
      const privateKey = localStorage.getItem('btcPrivateKey');
      if (!privateKey) {
        throw new Error('未找到钱包私钥，请重新连接钱包');
      }
      
      // 创建铭文交易
      const inscriptionTx = await this.createInscriptionTransaction(
        privateKey,
        content,
        type,
        feeRate
      );
      
      // 广播交易
      const txid = await this.broadcastTransaction(inscriptionTx);
      
      if (txid) {
        // 将新铭文添加到本地列表
        const newInscription = {
          id: `inscription_${txid.slice(0, 8)}`,
          type: type,
          content: content,
          timestamp: Date.now(),
          txid: txid,
          status: 'pending'
        };
        
        this.inscriptions.unshift(newInscription);
        return txid;
      } else {
        throw new Error('交易广播失败');
      }
      
    } catch (error) {
      console.error('铸造过程失败:', error);
      throw error;
    }
  }

  async createInscriptionTransaction(privateKey, content, type, feeRate) {
    try {
      // 这里需要实现真实的铭文交易创建逻辑
      // 使用 bitcoinjs-lib 创建交易
      
      const bitcoin = window.bitcoin;
      const network = bitcoin.networks.bitcoin;
      
      // 解析私钥
      const keyPair = bitcoin.ECPair.fromWIF(privateKey, network);
      const address = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: network
      }).address;
      
      // 获取UTXO
      const utxos = await this.getUTXOs(address);
      if (utxos.length === 0) {
        throw new Error('没有可用的UTXO');
      }
      
      // 创建交易构建器
      const txb = new bitcoin.TransactionBuilder(network);
      
      // 添加输入
      let totalInput = 0;
      utxos.forEach(utxo => {
        txb.addInput(utxo.txid, utxo.vout);
        totalInput += utxo.value;
      });
      
      // 计算输出
      const contentBytes = new TextEncoder().encode(content);
      const contentLength = contentBytes.length;
      
      // 估算交易大小（简化计算）
      const estimatedSize = 10 + utxos.length * 148 + contentLength + 34;
      const fee = Math.ceil(estimatedSize * feeRate / 1000);
      
      // 添加铭文输出（发送给自己）
      txb.addOutput(address, 546); // 最小输出金额
      
      // 添加找零输出
      const change = totalInput - fee - 546;
      if (change > 546) {
        txb.addOutput(address, change);
      }
      
      // 签名所有输入
      utxos.forEach((utxo, index) => {
        txb.sign(index, keyPair);
      });
      
      // 构建交易
      const tx = txb.build();
      
      return tx.toHex();
      
    } catch (error) {
      console.error('创建铭文交易失败:', error);
      throw new Error('创建交易失败: ' + error.message);
    }
  }

  async getUTXOs(address) {
    try {
      // 使用 mempool.space API 获取UTXO
      const response = await fetch(`https://mempool.space/api/address/${address}/utxo`);
      
      if (!response.ok) {
        throw new Error(`获取UTXO失败: ${response.status}`);
      }
      
      const utxos = await response.json();
      
      return utxos.map(utxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        script: utxo.scriptpubkey
      }));
      
    } catch (error) {
      console.error('获取UTXO失败:', error);
      throw new Error('无法获取UTXO: ' + error.message);
    }
  }

  async broadcastTransaction(txHex) {
    try {
      // 尝试多个广播服务
      const broadcastServices = [
        'https://mempool.space/api/tx',
        'https://blockstream.info/api/tx',
        'https://api.blockcypher.com/v1/btc/main/txs/push'
      ];
      
      for (const service of broadcastServices) {
        try {
          console.log(`尝试通过 ${service} 广播交易...`);
          
          const response = await fetch(service, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tx: txHex
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            const txid = result.txid || result.tx?.hash || result;
            console.log(`交易广播成功: ${txid}`);
            return txid;
          }
        } catch (error) {
          console.warn(`广播服务 ${service} 失败:`, error.message);
          continue;
        }
      }
      
      throw new Error('所有广播服务都失败');
      
    } catch (error) {
      console.error('广播交易失败:', error);
      throw new Error('交易广播失败: ' + error.message);
    }
  }

  showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // 显示通知
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);
    
    // 自动隐藏
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }
}

// 初始化BRC20管理器
let brc20Manager;

document.addEventListener('DOMContentLoaded', function() {
  brc20Manager = new BRC20Manager();
});

// 监听钱包连接事件
document.addEventListener('walletConnected', function(event) {
  if (brc20Manager) {
    brc20Manager.walletAddress = event.detail.address;
    brc20Manager.loadInscriptions();
  }
});

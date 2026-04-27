'use strict';

// ──────────────────────────────────────────────────────────────────────────────
//  BearingFL — Technical Glossary
// ──────────────────────────────────────────────────────────────────────────────

const GUIDE_TERMS = [
  // ── Federated Learning ─────────────────────────────────────────────────────
  {
    category: 'Federated Learning',
    terms: [
      {
        name: 'Federated Learning (FL)',
        desc: 'A distributed machine learning approach where multiple clients (e.g., machines or sensors) each train a model on their own local data. Only the model weights — never the raw data — are sent to a central server for aggregation. This preserves data privacy while still benefiting from the collective knowledge of all clients.',
      },
      {
        name: 'Communication Round',
        desc: 'One complete training cycle: (1) the server sends the current global model to selected clients, (2) each client trains locally for a number of epochs, (3) clients send their updated weights back, and (4) the server aggregates them into a new global model. Repeating many rounds produces a well-trained model.',
      },
      {
        name: 'Aggregation Strategy',
        desc: 'The algorithm the server uses to combine model updates from all participating clients into a single global model. The choice of strategy significantly affects convergence speed and final accuracy, especially when clients have unequal amounts or distributions of data.',
      },
      {
        name: 'FedAvg',
        desc: 'Federated Averaging — the foundational FL algorithm. The server computes a weighted average of client model weights, where each client\'s weight is proportional to its number of training samples. Simple and effective when data is reasonably similar across clients.',
      },
      {
        name: 'FedProx',
        desc: 'An extension of FedAvg that adds a proximal regularisation term (controlled by μ) to each client\'s loss function. This prevents local models from drifting too far from the global model during local training — particularly useful when client data distributions differ significantly (non-IID).',
      },
      {
        name: 'FedNova',
        desc: 'Federated Normalised Averaging — addresses a known limitation of FedAvg where clients that train for more local steps disproportionately influence the global model. FedNova normalises each client\'s update by its number of local steps before aggregation, leading to fairer and more stable convergence.',
      },
      {
        name: 'FedBN',
        desc: 'Federated Batch Normalisation — keeps the batch normalisation layer statistics (mean and variance) local to each client instead of aggregating them. This allows each client to adapt to its own data distribution while still sharing all other model parameters. Especially effective when clients have different operating conditions (feature shift).',
      },
      {
        name: 'Fraction Fit',
        desc: 'The proportion of available clients randomly selected to participate in each training round. For example, 0.5 means 50% of all registered clients are chosen per round. Using a fraction rather than all clients reduces communication cost and can improve robustness.',
      },
      {
        name: 'FedProx μ (Mu)',
        desc: 'The regularisation strength parameter in FedProx. A larger μ keeps local models closer to the global model (more conservative updates), while μ = 0 reduces FedProx to standard FedAvg. Increase μ when client data is highly heterogeneous.',
      },
    ],
  },

  // ── Data & Partitioning ────────────────────────────────────────────────────
  {
    category: 'Data & Partitioning',
    terms: [
      {
        name: 'CWRU Dataset',
        desc: 'Case Western Reserve University Bearing Dataset — the most widely used benchmark for bearing fault diagnosis research. It contains 1D vibration signals recorded from drive-end and fan-end bearings under four conditions: Normal, Inner Race fault, Outer Race fault, and Ball fault, at various fault diameters and motor loads.',
      },
      {
        name: 'IID (Independent & Identically Distributed)',
        desc: 'A data distribution where each client has a balanced, random sample that is representative of the full dataset. In IID settings, FL behaves similarly to centralised training. This is the idealised case — real-world deployments are usually non-IID.',
      },
      {
        name: 'Non-IID',
        desc: 'A realistic scenario where data is distributed unevenly across clients — each client may only have samples from certain fault classes or operating conditions. Non-IID data makes FL harder because local models can overfit to local distributions and diverge from each other.',
      },
      {
        name: 'Dirichlet Distribution (α)',
        desc: 'A statistical method used to simulate non-IID data splits. The α parameter controls heterogeneity: a small α (e.g., 0.1) creates highly skewed distributions where each client sees very few classes; a large α (e.g., 100) produces near-IID distributions. Adjust α to simulate different real-world deployment conditions.',
      },
      {
        name: 'Data Partitioning',
        desc: 'The process of dividing the training dataset among clients. The strategy determines which samples each client receives. Partitioning by Dirichlet distribution, class-based sharding, or random splitting each produce different degrees of data heterogeneity.',
      },
      {
        name: 'Data Augmentation',
        desc: 'Artificially increasing the size and diversity of the training set by applying random transformations to existing samples — in this case, adding Gaussian noise to vibration signals. Augmentation reduces overfitting and improves the model\'s ability to generalise to slightly different operating conditions.',
      },
    ],
  },

  // ── Training & Optimisation ────────────────────────────────────────────────
  {
    category: 'Training & Optimisation',
    terms: [
      {
        name: 'Local Epochs',
        desc: 'The number of full passes each client makes over its local dataset before sending weight updates to the server. More epochs lead to stronger local updates but increase the risk of local models diverging from the global optimum — a phenomenon known as "client drift".',
      },
      {
        name: 'Batch Size',
        desc: 'The number of training samples processed together in one gradient update step. Smaller batches introduce more noise into the gradient (which can act as regularisation), while larger batches provide more stable and accurate gradient estimates but require more memory.',
      },
      {
        name: 'Learning Rate',
        desc: 'A scalar that controls how large a step the optimizer takes in the direction of the gradient. Too high a learning rate causes unstable training (loss diverges); too low causes very slow convergence. Often combined with a scheduler that reduces the rate over time.',
      },
      {
        name: 'Optimizer',
        desc: 'The algorithm that updates model weights using the computed gradients. SGD (Stochastic Gradient Descent) is simple and often generalises well. Adam and AdamW adaptively scale the learning rate for each parameter, leading to faster convergence on many tasks.',
      },
      {
        name: 'LR Scheduler',
        desc: 'A strategy that automatically adjusts the learning rate during training. For example, CosineAnnealingLR gradually decreases the rate following a cosine curve, which helps fine-tune the model in later rounds. StepLR reduces the rate by a fixed factor every N rounds.',
      },
      {
        name: 'Gradient Clipping',
        desc: 'A technique that caps the norm of the gradient vector to a maximum value before applying the weight update. This prevents "exploding gradients" — a numerical instability where very large gradients cause the model weights to diverge, especially in deep networks.',
      },
      {
        name: 'Label Smoothing',
        desc: 'Instead of training the model to output a hard probability of 1.0 for the correct class and 0.0 for others, label smoothing assigns a small probability (e.g., 0.1 / n_classes) to incorrect classes. This acts as regularisation, improving model calibration and reducing overconfident predictions.',
      },
      {
        name: 'Early Stopping',
        desc: 'A training control mechanism that halts the federated training process when the global validation metric (e.g., accuracy) stops improving for a specified number of consecutive rounds (the patience). This prevents overfitting and avoids wasting computation on rounds that no longer improve the model.',
      },
      {
        name: 'Weight Decay',
        desc: 'An L2 regularisation technique that adds a penalty proportional to the magnitude of the model weights to the loss function. This discourages the model from assigning very large weights to any single feature, reducing overfitting.',
      },
    ],
  },

  // ── Model & Evaluation ─────────────────────────────────────────────────────
  {
    category: 'Model & Evaluation',
    terms: [
      {
        name: 'CNN (Convolutional Neural Network)',
        desc: 'A neural network architecture that applies learnable filter (convolution) operations to detect local patterns in the input. For 1D vibration signals, 1D convolutions detect characteristic frequency patterns associated with different bearing faults.',
      },
      {
        name: 'ResNet (Residual Network)',
        desc: 'A deeper CNN architecture that introduces "skip connections" — shortcuts that bypass one or more layers. These connections allow gradients to flow directly through the network without vanishing, enabling training of much deeper models that generally achieve higher accuracy.',
      },
      {
        name: 'Dropout',
        desc: 'A regularisation technique where a random fraction of neurons are temporarily set to zero during each training step. This forces the network to learn redundant representations and prevents any single neuron from becoming too dominant, reducing overfitting.',
      },
      {
        name: 'Accuracy',
        desc: 'The proportion of all test samples that are correctly classified. Straightforward to interpret, but can be misleading when classes are imbalanced — a model that always predicts the most common class can have high accuracy but be useless in practice.',
      },
      {
        name: 'Loss',
        desc: 'A numerical measure of how wrong the model\'s predictions are compared to the ground truth labels. The optimizer tries to minimise this value. Lower loss generally means better predictions, though loss alone does not capture all aspects of model quality.',
      },
      {
        name: 'Confusion Matrix',
        desc: 'A square table where rows represent the true class and columns represent the predicted class. Diagonal cells show correct predictions; off-diagonal cells show misclassifications. It reveals which specific fault types the model confuses with each other.',
      },
      {
        name: 'F1 Score',
        desc: 'The harmonic mean of Precision and Recall: F1 = 2 × (Precision × Recall) / (Precision + Recall). It balances the trade-off between false positives (missed alarms) and false negatives (false alarms), making it a robust single-number summary of classification quality.',
      },
      {
        name: 'Precision',
        desc: 'Of all samples the model predicted as class X, what fraction actually belongs to class X? High precision means the model rarely raises false alarms. Precision = True Positives / (True Positives + False Positives).',
      },
      {
        name: 'Recall (Sensitivity)',
        desc: 'Of all actual class X samples, what fraction did the model correctly identify? High recall means the model rarely misses a fault. Recall = True Positives / (True Positives + False Negatives). Critical in safety applications where missing a fault is costly.',
      },
      {
        name: 'Per-Class Accuracy',
        desc: 'The fraction of samples from a specific fault class that are correctly classified. Useful for identifying which fault types the model handles well and which it struggles with — information not visible in the overall accuracy figure.',
      },
    ],
  },

  // ── Fault Classes ──────────────────────────────────────────────────────────
  {
    category: 'Bearing Fault Classes',
    terms: [
      {
        name: 'Normal (N)',
        desc: 'A healthy bearing with no seeded fault. Represents the baseline operating condition. The model must learn to distinguish this from all fault conditions.',
      },
      {
        name: 'Inner Race Fault (IR)',
        desc: 'A defect on the inner raceway of the bearing. As each rolling element passes over the defect, it generates a periodic impact. The frequency of these impacts (BPFI — Ball Pass Frequency Inner Race) depends on the bearing geometry and shaft speed.',
      },
      {
        name: 'Outer Race Fault (OR)',
        desc: 'A defect on the outer raceway of the bearing. Rolling elements repeatedly strike the fault, generating impacts at the BPFO (Ball Pass Frequency Outer Race). Outer race faults are stationary relative to the load zone and typically produce more consistent vibration patterns.',
      },
      {
        name: 'Ball Fault (B)',
        desc: 'A defect on one of the rolling elements (balls or rollers). As the defective element contacts both raceways twice per revolution, it produces impacts at the BSF (Ball Spin Frequency). Ball faults often create more complex, modulated vibration patterns that are harder to classify.',
      },
    ],
  },

  // ── Prediction & Inference ─────────────────────────────────────────────────
  {
    category: 'Prediction & Inference',
    terms: [
      {
        name: 'Sliding Window',
        desc: 'A technique for processing long vibration signals: the signal is divided into overlapping fixed-length segments (windows), each of which is independently classified. The window length and step size control how many segments are produced. More windows give more votes for the ensemble decision.',
      },
      {
        name: 'Ensemble Voting',
        desc: 'Combining predictions from multiple trained models (e.g., one per FL round or one per client) by counting which class receives the most votes. Ensemble methods are generally more robust and accurate than any single model, because individual model errors tend to cancel out.',
      },
      {
        name: 'Confidence',
        desc: 'The probability (0–100%) assigned by the model to its top predicted class, derived from the softmax output. A high confidence score indicates the model is certain about its prediction, but high confidence does not always guarantee correctness — calibration matters.',
      },
      {
        name: 'Dominant Class',
        desc: 'The fault class that received the highest probability across all windows of the analysed signal. This is the model\'s overall prediction for the entire signal segment submitted for diagnosis.',
      },
    ],
  },
];

// ── Render ────────────────────────────────────────────────────────────────────
function _renderGuide() {
  const body = document.getElementById('guide-body');
  body.innerHTML = '';

  GUIDE_TERMS.forEach(cat => {
    const section = document.createElement('div');
    section.className = 'guide-category';
    section.dataset.category = cat.category.toLowerCase();

    const title = document.createElement('div');
    title.className = 'guide-category-title';
    title.textContent = cat.category;
    section.appendChild(title);

    cat.terms.forEach(t => {
      const item = document.createElement('div');
      item.className = 'guide-term';
      item.dataset.search = (t.name + ' ' + t.desc + ' ' + cat.category).toLowerCase();

      const name = document.createElement('div');
      name.className = 'guide-term-name';
      name.textContent = t.name;
      // Tooltip: title = term name, body = first sentence of description
      const firstSentence = (t.desc.match(/^[^.!?]+[.!?]/) || [t.desc])[0];
      name.setAttribute('data-tooltip-title', t.name);
      name.setAttribute('data-tooltip', firstSentence);

      const desc = document.createElement('div');
      desc.className = 'guide-term-desc';
      desc.textContent = t.desc;

      item.appendChild(name);
      item.appendChild(desc);
      section.appendChild(item);
    });

    body.appendChild(section);
  });
}

// ── Search / filter ───────────────────────────────────────────────────────────
function filterGuide(query) {
  const q = query.trim().toLowerCase();
  const body = document.getElementById('guide-body');
  let anyVisible = false;

  body.querySelectorAll('.guide-term').forEach(el => {
    const match = !q || el.dataset.search.includes(q);
    el.classList.toggle('hidden', !match);
    if (match) anyVisible = true;
  });

  // Hide empty categories
  body.querySelectorAll('.guide-category').forEach(cat => {
    const hasVisible = Array.from(cat.querySelectorAll('.guide-term'))
      .some(el => !el.classList.contains('hidden'));
    cat.style.display = hasVisible ? '' : 'none';
  });

  // No results message
  let noRes = body.querySelector('.guide-no-results');
  if (!anyVisible) {
    if (!noRes) {
      noRes = document.createElement('div');
      noRes.className = 'guide-no-results';
      noRes.textContent = 'No matching terms found.';
      body.appendChild(noRes);
    }
  } else if (noRes) {
    noRes.remove();
  }
}

// ── Open / close ──────────────────────────────────────────────────────────────
function openGuide() {
  _renderGuide();
  document.getElementById('guide-overlay').classList.add('open');
  document.getElementById('guide-modal').classList.add('open');
  const inp = document.getElementById('guide-search');
  inp.value = '';
  filterGuide('');
  setTimeout(() => inp.focus(), 80);
}

function closeGuide() {
  document.getElementById('guide-overlay').classList.remove('open');
  document.getElementById('guide-modal').classList.remove('open');
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeGuide();
});

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorthStarPolarisTrustedPresentation = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SEMANTIC_SCHEMA = 'northstar.polaris.semantic-presentation.v1';
  var ANSWER_INTENTS = Object.freeze([
    'canonical_overview',
    'evidence_review',
    'unknowns_review'
  ]);
  var SELECTED_KINDS = Object.freeze(['customer', 'lead', 'work', 'none']);
  var SEMANTIC_KEYS = Object.freeze([
    'answerIntent', 'cardCount', 'evidenceCount', 'schemaVersion', 'selectedKind', 'unknownCount'
  ]);

  function invalid() {
    throw new Error('Unsupported Polaris trusted presentation contract.');
  }

  function exactObject(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      return invalid();
    }
    var keys = Reflect.ownKeys(value);
    if (keys.some(function (key) { return typeof key !== 'string'; })) return invalid();
    var sorted = keys.slice().sort();
    var expectedSorted = expected.slice().sort();
    if (sorted.length !== expectedSorted.length || sorted.some(function (key, index) {
      return key !== expectedSorted[index];
    })) return invalid();
    if (keys.some(function (key) {
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true;
    })) return invalid();
    return value;
  }

  function exactArray(value, maximum) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
      return invalid();
    }
    var keys = Reflect.ownKeys(value);
    var expected = ['length'];
    for (var index = 0; index < value.length; index += 1) expected.push(String(index));
    if (keys.some(function (key) { return typeof key !== 'string'; }) || keys.length !== expected.length ||
        expected.some(function (key) { return keys.indexOf(key) < 0; }) || expected.slice(1).some(function (key) {
          var descriptor = Object.getOwnPropertyDescriptor(value, key);
          return !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true;
        })) return invalid();
    return value;
  }

  function exactCount(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) return invalid();
    return value;
  }

  function kindName(kind) {
    if (SELECTED_KINDS.indexOf(kind) < 0) return invalid();
    return kind;
  }

  function plural(count, singular, pluralValue) {
    return count === 1 ? singular : pluralValue;
  }

  function counts(cards) {
    var values = exactArray(cards, 4);
    var evidenceCount = 0;
    var unknownCount = 0;
    values.forEach(function (card) {
      if (!card || typeof card !== 'object') return invalid();
      evidenceCount += exactArray(card.evidence, 12).length;
      unknownCount += exactArray(card.unknowns, 12).length;
    });
    exactCount(evidenceCount, 48);
    exactCount(unknownCount, 48);
    return Object.freeze({ cardCount: values.length, evidenceCount: evidenceCount, unknownCount: unknownCount });
  }

  function semanticExpectation(context) {
    if (context === null || context === undefined) {
      return Object.freeze({ selectedKind: 'none', cardCount: 0, evidenceCount: 0, unknownCount: 0 });
    }
    if (context.selected === null) {
      var emptyMeasured = counts(context.cards);
      if (emptyMeasured.cardCount !== 0) return invalid();
      return Object.freeze({ selectedKind: 'none', cardCount: 0, evidenceCount: 0, unknownCount: 0 });
    }
    var selected = exactObject(context && context.selected, ['id', 'kind']);
    var selectedKind = kindName(selected.kind);
    var measured = counts(context.cards);
    return Object.freeze({
      selectedKind: selectedKind,
      cardCount: measured.cardCount,
      evidenceCount: measured.evidenceCount,
      unknownCount: measured.unknownCount
    });
  }

  function validateSemanticChoice(value, context) {
    var choice = exactObject(value, SEMANTIC_KEYS);
    if (choice.schemaVersion !== SEMANTIC_SCHEMA || ANSWER_INTENTS.indexOf(choice.answerIntent) < 0 ||
        SELECTED_KINDS.indexOf(choice.selectedKind) < 0) return invalid();
    exactCount(choice.cardCount, 4);
    exactCount(choice.evidenceCount, 48);
    exactCount(choice.unknownCount, 48);
    if ((choice.selectedKind === 'none') !== (choice.cardCount === 0) ||
        (choice.cardCount === 0 && (choice.evidenceCount !== 0 || choice.unknownCount !== 0))) return invalid();
    if (context) {
      var expected = semanticExpectation(context);
      if (choice.selectedKind !== expected.selectedKind || choice.cardCount !== expected.cardCount ||
          choice.evidenceCount !== expected.evidenceCount || choice.unknownCount !== expected.unknownCount) {
        return invalid();
      }
    }
    return choice;
  }

  function semanticChoice(context, answerIntent) {
    var expected = semanticExpectation(context);
    var choice = {
      schemaVersion: SEMANTIC_SCHEMA,
      answerIntent: answerIntent || 'canonical_overview',
      selectedKind: expected.selectedKind,
      cardCount: expected.cardCount,
      evidenceCount: expected.evidenceCount,
      unknownCount: expected.unknownCount
    };
    validateSemanticChoice(choice, context);
    return Object.freeze(choice);
  }

  function answerText(kind, measured, intent) {
    if (kind === 'none') return 'Select one customer, lead, or work record to review canonical NorthStar intelligence.';
    var facts = measured.evidenceCount + ' supporting ' + plural(measured.evidenceCount, 'fact', 'facts');
    var unknowns = measured.unknownCount + ' unresolved ' + plural(measured.unknownCount, 'item', 'items');
    if (intent === 'evidence_review') {
      return 'The selected ' + kind + ' has ' + facts + '. Review the canonical record before taking action.';
    }
    if (intent === 'unknowns_review') {
      return 'The selected ' + kind + ' has ' + unknowns + '. Confirm missing details in the canonical record before taking action.';
    }
    return 'NorthStar found ' + facts + ' and ' + unknowns + ' for the selected ' + kind +
      '. Review the canonical record before taking action.';
  }

  function confidenceBasis(card) {
    var evidenceCount = card.evidence.length;
    if (card.confidence.value === null) return 'No bounded confidence values are recorded.';
    return evidenceCount + ' recorded canonical fact confidence ' +
      plural(evidenceCount, 'value', 'values') + '.';
  }

  function evidenceValue(entry) {
    if (entry.confidence === null) return 'A canonical fact is recorded without a bounded confidence value.';
    return 'A canonical fact is recorded with ' + Math.round(entry.confidence * 1000) / 10 + '% confidence.';
  }

  function unknownLabel(code) {
    var fixed = {
      customer_name_missing: 'Customer name is not recorded.',
      service_type_missing: 'Service type is not recorded.',
      work_scope_missing: 'Work scope is not recorded.',
      customer_price_missing: 'Customer-facing estimate is not recorded.',
      schedule_missing: 'A scheduled start is not recorded.'
    };
    if (Object.prototype.hasOwnProperty.call(fixed, code)) return fixed[code];
    if (/^not_calculated_[1-9][0-9]{0,2}$/.test(code)) return 'An additional calculation is not available.';
    return 'An expected record detail is not available.';
  }

  function trustedEvidence(entry, index) {
    exactObject(entry, ['confidence', 'id', 'label', 'source', 'untrustedText', 'value']);
    return Object.freeze({
      id: entry.id,
      label: 'Supporting fact ' + (index + 1),
      value: evidenceValue(entry),
      confidence: entry.confidence,
      source: entry.source,
      untrustedText: entry.untrustedText
    });
  }

  function trustedUnknown(entry) {
    exactObject(entry, ['code', 'label']);
    return Object.freeze({ code: entry.code, label: unknownLabel(entry.code) });
  }

  function trustedCard(card, kind) {
    exactObject(card, [
      'advisoryOnly', 'answer', 'authority', 'canonicalMutationAllowed', 'confidence', 'evidence',
      'kind', 'schemaVersion', 'subtitle', 'title', 'tone', 'unknowns'
    ]);
    var evidence = Object.freeze(exactArray(card.evidence, 12).map(trustedEvidence));
    var unknowns = Object.freeze(exactArray(card.unknowns, 12).map(trustedUnknown));
    var projected = {
      schemaVersion: card.schemaVersion,
      kind: card.kind,
      tone: card.tone,
      title: kind.charAt(0).toUpperCase() + kind.slice(1) + ' intelligence',
      subtitle: 'Selected ' + kind + ' record',
      answer: 'This advisory card summarizes ' + evidence.length + ' supporting ' +
        plural(evidence.length, 'fact', 'facts') + ' and ' + unknowns.length + ' unresolved ' +
        plural(unknowns.length, 'item', 'items') + ' for the selected ' + kind + '.',
      evidence: evidence,
      unknowns: unknowns,
      confidence: Object.freeze({
        value: card.confidence.value,
        level: card.confidence.level,
        basis: confidenceBasis({ evidence: evidence, confidence: card.confidence })
      }),
      authority: card.authority,
      advisoryOnly: card.advisoryOnly,
      canonicalMutationAllowed: card.canonicalMutationAllowed
    };
    return Object.freeze(projected);
  }

  function projectTrustedDisplay(cards, selected, answerIntent) {
    var chosenIntent = ANSWER_INTENTS.indexOf(answerIntent) >= 0 ? answerIntent : invalid();
    if (selected === null) {
      var empty = counts(cards);
      if (empty.cardCount !== 0) return invalid();
      return Object.freeze({
        answer: Object.freeze({ text: answerText('none', empty, chosenIntent), evidenceCount: 0, unknownCount: 0 }),
        cards: Object.freeze([])
      });
    }
    var selectedValue = exactObject(selected, ['id', 'kind']);
    var kind = kindName(selectedValue.kind);
    var measured = counts(cards);
    var projectedCards = Object.freeze(cards.map(function (card) { return trustedCard(card, kind); }));
    return Object.freeze({
      answer: Object.freeze({
        text: answerText(kind, measured, chosenIntent),
        evidenceCount: measured.evidenceCount,
        unknownCount: measured.unknownCount
      }),
      cards: projectedCards
    });
  }

  function sameDisplay(left, right) {
    if (!left || !right || left.answer.text !== right.answer.text ||
        left.cards.length !== right.cards.length) return false;
    return left.cards.every(function (card, index) {
      var expected = right.cards[index];
      if (card.title !== expected.title || card.subtitle !== expected.subtitle || card.answer !== expected.answer ||
          card.confidence.basis !== expected.confidence.basis || card.evidence.length !== expected.evidence.length ||
          card.unknowns.length !== expected.unknowns.length) return false;
      if (card.evidence.some(function (entry, evidenceIndex) {
        return entry.label !== expected.evidence[evidenceIndex].label || entry.value !== expected.evidence[evidenceIndex].value;
      })) return false;
      return !card.unknowns.some(function (entry, unknownIndex) {
        return entry.label !== expected.unknowns[unknownIndex].label;
      });
    });
  }

  function validateTrustedResponseDisplay(response) {
    if (!response || !Object.prototype.hasOwnProperty.call(response, 'selected') || !Array.isArray(response.cards)) return invalid();
    var matches = ANSWER_INTENTS.some(function (intent) {
      var expected;
      try { expected = projectTrustedDisplay(response.cards, response.selected, intent); } catch (_error) { return false; }
      return sameDisplay(response, expected);
    });
    if (!matches) return invalid();
    return response;
  }

  function validateTrustedCardDisplay(card) {
    if (!card || !card.authority || !card.authority.selected) return invalid();
    var expected = projectTrustedDisplay([card], card.authority.selected, 'canonical_overview').cards[0];
    if (!sameDisplay({ answer: { text: '' }, cards: [card] }, { answer: { text: '' }, cards: [expected] })) {
      return invalid();
    }
    return card;
  }

  return Object.freeze({
    ANSWER_INTENTS: ANSWER_INTENTS,
    SEMANTIC_KEYS: SEMANTIC_KEYS,
    SEMANTIC_SCHEMA: SEMANTIC_SCHEMA,
    projectTrustedDisplay: projectTrustedDisplay,
    semanticChoice: semanticChoice,
    validateSemanticChoice: validateSemanticChoice,
    validateTrustedCardDisplay: validateTrustedCardDisplay,
    validateTrustedResponseDisplay: validateTrustedResponseDisplay
  });
});

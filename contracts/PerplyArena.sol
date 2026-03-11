// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PerplyArena {
    uint8 public constant SIDE_LONG = 0;
    uint8 public constant SIDE_SHORT = 1;
    uint16 public constant BPS = 10_000;
    int256 private constant PRECISION = 1e18;
    uint256 private constant SECP256K1N_HALF =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    struct Position {
        uint256 margin;
        uint256 weight;
        uint32 leverage;
        uint64 entryPriceE8;
        int256 entryAccPnlPerWeight;
        int256 entryAccDebtPerWeight;
        bool isOpen;
    }

    struct PositionView {
        uint256 margin;
        uint256 weight;
        uint32 leverage;
        uint64 entryPriceE8;
        bool isOpen;
        int256 pnl;
        int256 equity;
        uint256 maintenanceMargin;
    }

    struct QueuedRiskParams {
        uint32 minSettlementInterval;
        uint16 volatilityTriggerBps;
        uint16 settlementStrengthBps;
        uint16 maxSettlementTransferBps;
        uint16 openFeeBps;
        uint16 closeFeeBps;
        uint16 settlementFeeBps;
        uint16 congestionStartBps;
        uint16 congestionFullBps;
        uint16 maxCongestionFeeBps;
        uint16 maintenanceBaseBps;
        uint16 maintenanceLeverageBps;
        uint16 liquidationPenaltyBps;
        uint16 liquidatorRewardShareBps;
    }

    struct TimelockedAddressOperation {
        address value;
        uint256 eta;
        bool queued;
    }

    struct TimelockedBoolOperation {
        bool value;
        uint256 eta;
        bool queued;
    }

    struct TimelockedWithdrawalOperation {
        address payable to;
        uint256 amount;
        uint256 eta;
        bool queued;
    }

    struct TimelockedUint32Operation {
        uint32 value;
        uint256 eta;
        bool queued;
    }

    address public owner;
    address public emergencyGuardian;
    address public keeper;
    address public priceSigner;

    uint256 public markPriceE8;
    uint256 public lastSettlementAt;
    uint256 public queuedRiskParamsEta;

    uint32 public riskParamsTimelockSec;
    uint32 public adminOpsTimelockSec;
    uint32 public maxPriceAgeSec;
    bool public hasQueuedRiskParams;
    bool public paused;
    bool public reduceOnly;
    bool public directSettlementEnabled;

    uint32 public minSettlementInterval;
    uint16 public volatilityTriggerBps;
    uint16 public settlementStrengthBps;
    uint16 public maxSettlementTransferBps;

    uint16 public openFeeBps;
    uint16 public closeFeeBps;
    uint16 public settlementFeeBps;

    uint16 public congestionStartBps;
    uint16 public congestionFullBps;
    uint16 public maxCongestionFeeBps;

    uint16 public maintenanceBaseBps;
    uint16 public maintenanceLeverageBps;
    uint16 public liquidationPenaltyBps;
    uint16 public liquidatorRewardShareBps;
    uint16 public minSettlementFloorBps;
    uint256 public minSettlementFloorAbsolute;

    uint256 public treasuryBalance;
    uint256 public insuranceFund;
    uint256 public systemBadDebt;

    mapping(address => uint256) public availableBalance;
    mapping(address => mapping(uint8 => Position)) private positions;
    mapping(bytes32 => bool) public usedPriceDigests;

    uint256[2] public sideWeight;
    uint256[2] public sideMargin;
    int256[2] public accPnlPerWeight;
    int256[2] public accDebtPerWeight;
    uint256[2] public sidePendingSettlementDebt;
    uint256[2] public cumulativeCongestionRewards;
    QueuedRiskParams private queuedRiskParams;
    TimelockedAddressOperation private queuedOwnershipTransfer;
    TimelockedAddressOperation private queuedKeeperUpdate;
    TimelockedAddressOperation private queuedPriceSignerUpdate;
    TimelockedBoolOperation private queuedDirectSettlementToggle;
    TimelockedBoolOperation private queuedPauseDisable;
    TimelockedBoolOperation private queuedReduceOnlyDisable;
    TimelockedUint32Operation private queuedMaxPriceAgeUpdate;
    TimelockedWithdrawalOperation private queuedTreasuryWithdrawal;
    TimelockedWithdrawalOperation private queuedInsuranceWithdrawal;

    error OnlyOwner();
    error UnauthorizedEmergencyManager();
    error UnauthorizedKeeper();
    error InvalidSide();
    error InvalidAmount();
    error InvalidPrice();
    error PriceOutOfRange();
    error InvalidLeverage();
    error PositionExists();
    error PositionMissing();
    error InsufficientBalance();
    error SettlementTooEarly();
    error NotLiquidatable();
    error TransferFailed();
    error Paused();
    error ReduceOnly();
    error DirectSettlementDisabled();
    error InvalidSignature();
    error SignatureAlreadyUsed();
    error StalePrice();
    error NoRiskParamsQueued();
    error RiskParamsAlreadyQueued();
    error RiskParamsTimelockPending();
    error NoAdminOperationQueued();
    error AdminOperationAlreadyQueued();
    error AdminOperationTimelockPending();
    error InvalidAddress();
    error SystemInsolvent();

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event EmergencyGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event OwnershipTransferQueued(address indexed newOwner, uint256 executeAfter);
    event OwnershipTransferCancelled(address indexed queuedOwner);
    event KeeperUpdated(address indexed newKeeper);
    event PriceSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event PriceAgeUpdated(uint32 maxPriceAgeSec);
    event PriceAgeUpdateQueued(uint32 newMaxPriceAgeSec, uint256 executeAfter);
    event PriceAgeUpdateCancelled(uint32 queuedMaxPriceAgeSec);
    event MarkPriceUpdated(uint256 oldPriceE8, uint256 newPriceE8);
    event ParamsUpdated();
    event RiskParamsQueued(bytes32 indexed paramsHash, uint256 executeAfter);
    event RiskParamsQueueCancelled(bytes32 indexed paramsHash);
    event RiskParamsTimelockUpdated(uint32 newDelaySec);
    event AdminOpsTimelockUpdated(uint32 newDelaySec);
    event PauseUpdated(bool paused);
    event PauseDisableQueued(uint256 executeAfter);
    event PauseDisableCancelled();
    event ReduceOnlyUpdated(bool reduceOnly);
    event ReduceOnlyDisableQueued(uint256 executeAfter);
    event ReduceOnlyDisableCancelled();
    event DirectSettlementToggled(bool enabled);
    event KeeperUpdateQueued(address indexed newKeeper, uint256 executeAfter);
    event KeeperUpdateCancelled(address indexed queuedKeeper);
    event PriceSignerUpdateQueued(address indexed newSigner, uint256 executeAfter);
    event PriceSignerUpdateCancelled(address indexed queuedSigner);
    event DirectSettlementToggleQueued(bool enabled, uint256 executeAfter);
    event DirectSettlementToggleCancelled(bool enabled);
    event TreasuryWithdrawalQueued(address indexed to, uint256 amount, uint256 executeAfter);
    event TreasuryWithdrawalCancelled(address indexed to, uint256 amount);
    event InsuranceWithdrawalQueued(address indexed to, uint256 amount, uint256 executeAfter);
    event InsuranceWithdrawalCancelled(address indexed to, uint256 amount);

    event Deposited(address indexed trader, uint256 amount, uint256 newAvailableBalance);
    event Withdrawn(address indexed trader, uint256 amount, uint256 newAvailableBalance);

    event PositionOpened(
        address indexed trader,
        uint8 indexed side,
        uint256 margin,
        uint32 leverage,
        uint256 weight,
        uint256 openFee,
        uint16 congestionRateBps,
        uint256 congestionFee,
        uint256 congestionToOpposite,
        uint256 congestionToTreasury
    );

    event PositionClosed(
        address indexed trader,
        uint8 indexed side,
        uint256 margin,
        uint256 weight,
        uint32 leverage,
        int256 pnl,
        int256 equityBeforeFees,
        uint256 closeFee,
        uint256 payout
    );

    event PositionLiquidated(
        address indexed trader,
        address indexed liquidator,
        uint8 indexed side,
        int256 pnl,
        int256 equityBeforePenalty,
        uint256 liquidationPenalty,
        uint256 liquidatorReward,
        uint256 insuranceReward,
        uint256 traderPayout
    );

    event Settled(
        uint256 oldPriceE8,
        uint256 newPriceE8,
        uint8 winnerSide,
        uint8 loserSide,
        uint256 grossTransfer,
        uint256 settlementFee,
        uint256 winnerNet,
        uint256 matchedWeight
    );

    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event InsuranceWithdrawn(address indexed to, uint256 amount);
    event InsuranceFunded(address indexed sender, uint256 amount, uint256 remainingBadDebt);
    event BadDebtRecorded(uint256 uncoveredDebt, uint256 totalBadDebt);
    event SettlementFloorUpdated(uint256 minSettlementFloorAbsolute, uint16 minSettlementFloorBps);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier whenNotReduceOnly() {
        if (reduceOnly) revert ReduceOnly();
        _;
    }

    constructor(uint256 initialPriceE8) {
        if (initialPriceE8 == 0) revert InvalidPrice();
        if (initialPriceE8 > type(uint64).max) revert PriceOutOfRange();

        owner = msg.sender;
        emergencyGuardian = msg.sender;
        keeper = msg.sender;
        priceSigner = msg.sender;

        markPriceE8 = initialPriceE8;
        lastSettlementAt = block.timestamp;
        maxPriceAgeSec = 90;
        riskParamsTimelockSec = 6 hours;
        adminOpsTimelockSec = 6 hours;
        directSettlementEnabled = false;

        minSettlementInterval = 3;
        volatilityTriggerBps = 15; // 0.15%
        settlementStrengthBps = 8000; // k = 0.8
        maxSettlementTransferBps = 3000; // max 30% of losing side margin per tick

        openFeeBps = 50; // 0.5%
        closeFeeBps = 50; // 0.5%
        settlementFeeBps = 1; // 0.01%

        congestionStartBps = 1000; // starts when imbalance >10%
        congestionFullBps = 5000; // reaches max when imbalance >=50%
        maxCongestionFeeBps = 50; // 0.5%

        maintenanceBaseBps = 600; // 6% of margin
        maintenanceLeverageBps = 40; // +0.4% * leverage
        liquidationPenaltyBps = 200; // 2%
        liquidatorRewardShareBps = 5000; // 50% of penalty to liquidator

        minSettlementFloorAbsolute = 0.01 ether; // 0.01 MON absolute floor
        minSettlementFloorBps = 1; // 0.01% of matched weight
    }

    receive() external payable {
        _deposit(msg.sender, msg.value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        if (queuedOwnershipTransfer.queued) revert AdminOperationAlreadyQueued();
        queuedOwnershipTransfer = TimelockedAddressOperation({
            value: newOwner,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit OwnershipTransferQueued(newOwner, queuedOwnershipTransfer.eta);
    }

    function executeOwnershipTransfer() external onlyOwner {
        if (!queuedOwnershipTransfer.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedOwnershipTransfer.eta) revert AdminOperationTimelockPending();
        address oldOwner = owner;
        owner = queuedOwnershipTransfer.value;
        delete queuedOwnershipTransfer;
        emit OwnershipTransferred(oldOwner, owner);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        if (!queuedOwnershipTransfer.queued) revert NoAdminOperationQueued();
        address queued = queuedOwnershipTransfer.value;
        delete queuedOwnershipTransfer;
        emit OwnershipTransferCancelled(queued);
    }

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert InvalidAddress();
        if (queuedKeeperUpdate.queued) revert AdminOperationAlreadyQueued();
        queuedKeeperUpdate = TimelockedAddressOperation({
            value: newKeeper,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit KeeperUpdateQueued(newKeeper, queuedKeeperUpdate.eta);
    }

    function setEmergencyGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert InvalidAddress();
        address oldGuardian = emergencyGuardian;
        emergencyGuardian = newGuardian;
        emit EmergencyGuardianUpdated(oldGuardian, newGuardian);
    }

    function executeKeeperUpdate() external onlyOwner {
        if (!queuedKeeperUpdate.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedKeeperUpdate.eta) revert AdminOperationTimelockPending();
        keeper = queuedKeeperUpdate.value;
        delete queuedKeeperUpdate;
        emit KeeperUpdated(keeper);
    }

    function cancelKeeperUpdate() external onlyOwner {
        if (!queuedKeeperUpdate.queued) revert NoAdminOperationQueued();
        address queued = queuedKeeperUpdate.value;
        delete queuedKeeperUpdate;
        emit KeeperUpdateCancelled(queued);
    }

    function setPriceSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidAddress();
        if (queuedPriceSignerUpdate.queued) revert AdminOperationAlreadyQueued();
        queuedPriceSignerUpdate = TimelockedAddressOperation({
            value: newSigner,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit PriceSignerUpdateQueued(newSigner, queuedPriceSignerUpdate.eta);
    }

    function executePriceSignerUpdate() external onlyOwner {
        if (!queuedPriceSignerUpdate.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedPriceSignerUpdate.eta) revert AdminOperationTimelockPending();
        address oldSigner = priceSigner;
        priceSigner = queuedPriceSignerUpdate.value;
        delete queuedPriceSignerUpdate;
        emit PriceSignerUpdated(oldSigner, priceSigner);
    }

    function cancelPriceSignerUpdate() external onlyOwner {
        if (!queuedPriceSignerUpdate.queued) revert NoAdminOperationQueued();
        address queued = queuedPriceSignerUpdate.value;
        delete queuedPriceSignerUpdate;
        emit PriceSignerUpdateCancelled(queued);
    }

    function setMaxPriceAgeSec(uint32 newMaxPriceAgeSec) external onlyOwner {
        if (newMaxPriceAgeSec == 0 || newMaxPriceAgeSec > 900) revert InvalidAmount();
        if (queuedMaxPriceAgeUpdate.queued) revert AdminOperationAlreadyQueued();
        queuedMaxPriceAgeUpdate = TimelockedUint32Operation({
            value: newMaxPriceAgeSec,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit PriceAgeUpdateQueued(newMaxPriceAgeSec, queuedMaxPriceAgeUpdate.eta);
    }

    function executeMaxPriceAgeSecUpdate() external onlyOwner {
        if (!queuedMaxPriceAgeUpdate.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedMaxPriceAgeUpdate.eta) revert AdminOperationTimelockPending();
        maxPriceAgeSec = queuedMaxPriceAgeUpdate.value;
        uint32 value = queuedMaxPriceAgeUpdate.value;
        delete queuedMaxPriceAgeUpdate;
        emit PriceAgeUpdated(value);
    }

    function cancelMaxPriceAgeSecUpdate() external onlyOwner {
        if (!queuedMaxPriceAgeUpdate.queued) revert NoAdminOperationQueued();
        uint32 value = queuedMaxPriceAgeUpdate.value;
        delete queuedMaxPriceAgeUpdate;
        emit PriceAgeUpdateCancelled(value);
    }

    function setRiskParamsTimelockSec(uint32 newDelaySec) external onlyOwner {
        if (newDelaySec < 1 hours || newDelaySec > 7 days) revert InvalidAmount();
        riskParamsTimelockSec = newDelaySec;
        emit RiskParamsTimelockUpdated(newDelaySec);
    }

    function setAdminOpsTimelockSec(uint32 newDelaySec) external onlyOwner {
        if (newDelaySec < 1 hours || newDelaySec > 7 days) revert InvalidAmount();
        adminOpsTimelockSec = newDelaySec;
        emit AdminOpsTimelockUpdated(newDelaySec);
    }

    function setSettlementFloor(uint256 newMinSettlementFloorAbsolute, uint16 newMinSettlementFloorBps) external onlyOwner {
        if (newMinSettlementFloorAbsolute > 100 ether) revert InvalidAmount();
        if (newMinSettlementFloorBps > 1000) revert InvalidAmount();
        minSettlementFloorAbsolute = newMinSettlementFloorAbsolute;
        minSettlementFloorBps = newMinSettlementFloorBps;
        emit SettlementFloorUpdated(newMinSettlementFloorAbsolute, newMinSettlementFloorBps);
    }

    function setPaused(bool newPaused) external {
        if (newPaused) {
            if (msg.sender != owner && msg.sender != emergencyGuardian) revert UnauthorizedEmergencyManager();
            if (!paused) {
                paused = true;
                emit PauseUpdated(true);
            }
            return;
        }

        if (msg.sender != owner) revert OnlyOwner();
        if (!paused) return;
        if (queuedPauseDisable.queued) revert AdminOperationAlreadyQueued();
        queuedPauseDisable = TimelockedBoolOperation({
            value: false,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit PauseDisableQueued(queuedPauseDisable.eta);
    }

    function executePauseDisable() external onlyOwner {
        if (!queuedPauseDisable.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedPauseDisable.eta) revert AdminOperationTimelockPending();
        paused = false;
        delete queuedPauseDisable;
        emit PauseUpdated(false);
    }

    function cancelPauseDisable() external onlyOwner {
        if (!queuedPauseDisable.queued) revert NoAdminOperationQueued();
        delete queuedPauseDisable;
        emit PauseDisableCancelled();
    }

    function setReduceOnly(bool newReduceOnly) external {
        if (newReduceOnly) {
            if (msg.sender != owner && msg.sender != emergencyGuardian) revert UnauthorizedEmergencyManager();
            if (!reduceOnly) {
                reduceOnly = true;
                emit ReduceOnlyUpdated(true);
            }
            return;
        }

        if (msg.sender != owner) revert OnlyOwner();
        if (!reduceOnly) return;
        if (queuedReduceOnlyDisable.queued) revert AdminOperationAlreadyQueued();
        queuedReduceOnlyDisable = TimelockedBoolOperation({
            value: false,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit ReduceOnlyDisableQueued(queuedReduceOnlyDisable.eta);
    }

    function executeReduceOnlyDisable() external onlyOwner {
        if (!queuedReduceOnlyDisable.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedReduceOnlyDisable.eta) revert AdminOperationTimelockPending();
        reduceOnly = false;
        delete queuedReduceOnlyDisable;
        emit ReduceOnlyUpdated(false);
    }

    function cancelReduceOnlyDisable() external onlyOwner {
        if (!queuedReduceOnlyDisable.queued) revert NoAdminOperationQueued();
        delete queuedReduceOnlyDisable;
        emit ReduceOnlyDisableCancelled();
    }

    function setDirectSettlementEnabled(bool enabled) external onlyOwner {
        if (queuedDirectSettlementToggle.queued) revert AdminOperationAlreadyQueued();
        queuedDirectSettlementToggle = TimelockedBoolOperation({
            value: enabled,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit DirectSettlementToggleQueued(enabled, queuedDirectSettlementToggle.eta);
    }

    function executeDirectSettlementToggle() external onlyOwner {
        if (!queuedDirectSettlementToggle.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedDirectSettlementToggle.eta) revert AdminOperationTimelockPending();
        directSettlementEnabled = queuedDirectSettlementToggle.value;
        bool value = queuedDirectSettlementToggle.value;
        delete queuedDirectSettlementToggle;
        emit DirectSettlementToggled(value);
    }

    function cancelDirectSettlementToggle() external onlyOwner {
        if (!queuedDirectSettlementToggle.queued) revert NoAdminOperationQueued();
        bool value = queuedDirectSettlementToggle.value;
        delete queuedDirectSettlementToggle;
        emit DirectSettlementToggleCancelled(value);
    }

    function setRiskParams(
        uint32 newMinSettlementInterval,
        uint16 newVolatilityTriggerBps,
        uint16 newSettlementStrengthBps,
        uint16 newMaxSettlementTransferBps,
        uint16 newOpenFeeBps,
        uint16 newCloseFeeBps,
        uint16 newSettlementFeeBps,
        uint16 newCongestionStartBps,
        uint16 newCongestionFullBps,
        uint16 newMaxCongestionFeeBps,
        uint16 newMaintenanceBaseBps,
        uint16 newMaintenanceLeverageBps,
        uint16 newLiquidationPenaltyBps,
        uint16 newLiquidatorRewardShareBps
    ) external onlyOwner {
        if (hasQueuedRiskParams) revert RiskParamsAlreadyQueued();
        _validateRiskParams(
            newMinSettlementInterval,
            newVolatilityTriggerBps,
            newSettlementStrengthBps,
            newMaxSettlementTransferBps,
            newOpenFeeBps,
            newCloseFeeBps,
            newSettlementFeeBps,
            newCongestionStartBps,
            newCongestionFullBps,
            newMaxCongestionFeeBps,
            newMaintenanceBaseBps,
            newMaintenanceLeverageBps,
            newLiquidationPenaltyBps,
            newLiquidatorRewardShareBps
        );

        QueuedRiskParams memory cfg = QueuedRiskParams({
            minSettlementInterval: newMinSettlementInterval,
            volatilityTriggerBps: newVolatilityTriggerBps,
            settlementStrengthBps: newSettlementStrengthBps,
            maxSettlementTransferBps: newMaxSettlementTransferBps,
            openFeeBps: newOpenFeeBps,
            closeFeeBps: newCloseFeeBps,
            settlementFeeBps: newSettlementFeeBps,
            congestionStartBps: newCongestionStartBps,
            congestionFullBps: newCongestionFullBps,
            maxCongestionFeeBps: newMaxCongestionFeeBps,
            maintenanceBaseBps: newMaintenanceBaseBps,
            maintenanceLeverageBps: newMaintenanceLeverageBps,
            liquidationPenaltyBps: newLiquidationPenaltyBps,
            liquidatorRewardShareBps: newLiquidatorRewardShareBps
        });

        bytes32 paramsHash = _hashRiskParams(cfg);
        queuedRiskParams = cfg;
        hasQueuedRiskParams = true;
        queuedRiskParamsEta = block.timestamp + riskParamsTimelockSec;

        emit RiskParamsQueued(paramsHash, queuedRiskParamsEta);
    }

    function executeRiskParams() external onlyOwner {
        if (!hasQueuedRiskParams) revert NoRiskParamsQueued();
        if (block.timestamp < queuedRiskParamsEta) revert RiskParamsTimelockPending();

        _applyRiskParams(queuedRiskParams);

        delete queuedRiskParams;
        hasQueuedRiskParams = false;
        queuedRiskParamsEta = 0;

        emit ParamsUpdated();
    }

    function cancelRiskParamsQueue() external onlyOwner {
        if (!hasQueuedRiskParams) revert NoRiskParamsQueued();

        bytes32 paramsHash = _hashRiskParams(queuedRiskParams);
        delete queuedRiskParams;
        hasQueuedRiskParams = false;
        queuedRiskParamsEta = 0;
        emit RiskParamsQueueCancelled(paramsHash);
    }

    function deposit() external payable whenNotPaused {
        _deposit(msg.sender, msg.value);
    }

    function donateInsurance() external payable {
        if (msg.value == 0) revert InvalidAmount();
        _creditInsurance(msg.value);
        emit InsuranceFunded(msg.sender, msg.value, systemBadDebt);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (availableBalance[msg.sender] < amount) revert InsufficientBalance();

        availableBalance[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, availableBalance[msg.sender]);
    }

    function previewOpen(uint8 side, uint256 margin, uint32 leverage)
        external
        view
        returns (
            uint256 openFee,
            uint16 congestionRateBps,
            uint256 congestionFee,
            uint256 congestionToOpposite,
            uint256 congestionToTreasury,
            uint256 totalRequired
        )
    {
        if (side > SIDE_SHORT) revert InvalidSide();
        if (margin == 0) revert InvalidAmount();
        if (leverage < 2 || leverage > 100) revert InvalidLeverage();

        openFee = (margin * openFeeBps) / BPS;
        congestionRateBps = _congestionRateBps(side);
        congestionFee = (margin * congestionRateBps) / BPS;
        congestionToOpposite = (congestionFee * 8000) / BPS;
        congestionToTreasury = congestionFee - congestionToOpposite;
        totalRequired = margin + openFee + congestionFee;
    }

    function openPosition(uint8 side, uint256 margin, uint32 leverage) external whenNotPaused whenNotReduceOnly {
        if (systemBadDebt > 0) revert SystemInsolvent();
        if (side > SIDE_SHORT) revert InvalidSide();
        if (margin == 0) revert InvalidAmount();
        if (leverage < 2 || leverage > 100) revert InvalidLeverage();
        if (positions[msg.sender][side].isOpen) revert PositionExists();

        uint256 openFee = (margin * openFeeBps) / BPS;
        uint16 congestionRate = _congestionRateBps(side);
        uint256 congestionFee = (margin * congestionRate) / BPS;
        uint256 totalRequired = margin + openFee + congestionFee;
        if (availableBalance[msg.sender] < totalRequired) revert InsufficientBalance();

        availableBalance[msg.sender] -= totalRequired;

        treasuryBalance += openFee;
        uint256 congestionToOpposite = (congestionFee * 8000) / BPS;
        uint256 congestionToTreasury = congestionFee - congestionToOpposite;

        uint8 opposite = _opposite(side);
        if (congestionToOpposite > 0 && sideWeight[opposite] > 0) {
            _applySideDelta(opposite, _toInt256(congestionToOpposite));
            cumulativeCongestionRewards[opposite] += congestionToOpposite;
        } else {
            congestionToTreasury += congestionToOpposite;
            congestionToOpposite = 0;
        }
        treasuryBalance += congestionToTreasury;

        uint256 weight = margin * leverage;
        positions[msg.sender][side] = Position({
            margin: margin,
            weight: weight,
            leverage: leverage,
            entryPriceE8: _toUint64(markPriceE8),
            entryAccPnlPerWeight: accPnlPerWeight[side],
            entryAccDebtPerWeight: accDebtPerWeight[side],
            isOpen: true
        });

        sideWeight[side] += weight;
        sideMargin[side] += margin;

        emit PositionOpened(
            msg.sender,
            side,
            margin,
            leverage,
            weight,
            openFee,
            congestionRate,
            congestionFee,
            congestionToOpposite,
            congestionToTreasury
        );
    }

    function closePosition(uint8 side) external {
        _closePosition(msg.sender, side);
    }

    function liquidate(address trader, uint8 side) external {
        if (side > SIDE_SHORT) revert InvalidSide();
        Position memory pos = positions[trader][side];
        if (!pos.isOpen) revert PositionMissing();

        int256 pnl = _positionPnl(pos, side);
        int256 equitySigned = _toInt256(pos.margin) + pnl;
        uint256 maintenance = _maintenanceMargin(pos);

        if (equitySigned > _toInt256(maintenance)) revert NotLiquidatable();

        _removePosition(trader, side, pos);

        uint256 payout = 0;
        uint256 liquidationPenalty = 0;
        uint256 liquidatorReward = 0;
        uint256 insuranceReward = 0;

        if (equitySigned > 0) {
            uint256 equity = _toUint256(equitySigned);
            liquidationPenalty = (equity * liquidationPenaltyBps) / BPS;
            if (liquidationPenalty > equity) liquidationPenalty = equity;
            liquidatorReward = (liquidationPenalty * liquidatorRewardShareBps) / BPS;
            insuranceReward = liquidationPenalty - liquidatorReward;
            payout = equity - liquidationPenalty;

            if (payout > 0) {
                availableBalance[trader] += payout;
            }
            if (liquidatorReward > 0) {
                availableBalance[msg.sender] += liquidatorReward;
            }
            if (insuranceReward > 0) {
                _creditInsurance(insuranceReward);
            }
        } else if (equitySigned < 0) {
            _coverBadDebt(_toAbsUint(equitySigned));
        }

        emit PositionLiquidated(
            trader,
            msg.sender,
            side,
            pnl,
            equitySigned,
            liquidationPenalty,
            liquidatorReward,
            insuranceReward,
            payout
        );
    }

    function settleWithPrice(uint256 newPriceE8) external {
        if (!directSettlementEnabled) revert DirectSettlementDisabled();
        if (msg.sender != keeper && msg.sender != owner) revert UnauthorizedKeeper();
        _settleWithPrice(newPriceE8);
    }

    function settleWithSignedPrice(uint256 newPriceE8, uint64 priceTimestamp, uint64 salt, bytes calldata signature) external {
        if (msg.sender != keeper && msg.sender != owner) revert UnauthorizedKeeper();
        if (newPriceE8 == 0) revert InvalidPrice();
        if (priceTimestamp > block.timestamp) revert StalePrice();

        bytes32 digest = _priceDigest(newPriceE8, priceTimestamp, salt);
        if (usedPriceDigests[digest]) revert SignatureAlreadyUsed();
        address recovered = _recoverSigner(digest, signature);
        if (recovered != priceSigner) revert InvalidSignature();
        if (block.timestamp - priceTimestamp > maxPriceAgeSec) revert StalePrice();
        if (priceTimestamp <= lastSettlementAt) revert StalePrice();
        usedPriceDigests[digest] = true;

        _settleWithPrice(newPriceE8);
    }

    function _settleWithPrice(uint256 newPriceE8) internal {
        if (newPriceE8 == 0) revert InvalidPrice();
        if (newPriceE8 > type(uint64).max) revert PriceOutOfRange();

        uint256 oldPrice = markPriceE8;
        if (oldPrice == 0) revert InvalidPrice();

        uint256 absDelta = newPriceE8 > oldPrice ? newPriceE8 - oldPrice : oldPrice - newPriceE8;
        uint256 deltaBps = (absDelta * BPS) / oldPrice;

        bool intervalElapsed = block.timestamp >= lastSettlementAt + minSettlementInterval;
        if (!intervalElapsed && deltaBps < volatilityTriggerBps) {
            revert SettlementTooEarly();
        }

        uint8 winnerSide = 255;
        uint8 loserSide = 255;
        uint256 matchedWeight = 0;
        uint256 grossTransfer = 0;
        uint256 settlementFee = 0;
        uint256 winnerNet = 0;

        if (newPriceE8 != oldPrice && sideWeight[SIDE_LONG] > 0 && sideWeight[SIDE_SHORT] > 0) {
            uint8 priceWinnerSide = newPriceE8 > oldPrice ? SIDE_LONG : SIDE_SHORT;
            uint8 priceLoserSide = priceWinnerSide == SIDE_LONG ? SIDE_SHORT : SIDE_LONG;

            matchedWeight = _min(sideWeight[SIDE_LONG], sideWeight[SIDE_SHORT]);
            uint256 rawTransfer = (matchedWeight * absDelta * settlementStrengthBps) / oldPrice / BPS;
            if (rawTransfer > 0) {
                _accruePendingSettlementDebt(priceLoserSide, rawTransfer);
            }
        }

        // Realize pending debt in capped batches from each debtor side.
        (uint256 longGross, uint256 longFee, uint256 longNet) = _realizePendingDebtForSide(SIDE_LONG);
        (uint256 shortGross, uint256 shortFee, uint256 shortNet) = _realizePendingDebtForSide(SIDE_SHORT);

        grossTransfer = longGross + shortGross;
        settlementFee = longFee + shortFee;
        winnerNet = longNet + shortNet;

        if (longGross > 0 && shortGross == 0) {
            loserSide = SIDE_LONG;
            winnerSide = SIDE_SHORT;
        } else if (shortGross > 0 && longGross == 0) {
            loserSide = SIDE_SHORT;
            winnerSide = SIDE_LONG;
        }

        markPriceE8 = newPriceE8;
        lastSettlementAt = block.timestamp;
        emit MarkPriceUpdated(oldPrice, newPriceE8);
        emit Settled(
            oldPrice,
            newPriceE8,
            winnerSide,
            loserSide,
            grossTransfer,
            settlementFee,
            winnerNet,
            matchedWeight
        );
    }

    function getPosition(address trader, uint8 side) external view returns (PositionView memory pv) {
        if (side > SIDE_SHORT) revert InvalidSide();
        Position memory pos = positions[trader][side];
        if (!pos.isOpen) {
            return pv;
        }

        int256 pnl = _positionPnl(pos, side);
        int256 equity = _toInt256(pos.margin) + pnl;

        pv = PositionView({
            margin: pos.margin,
            weight: pos.weight,
            leverage: pos.leverage,
            entryPriceE8: pos.entryPriceE8,
            isOpen: true,
            pnl: pnl,
            equity: equity,
            maintenanceMargin: _maintenanceMargin(pos)
        });
    }

    function getCongestionRatesBps() external view returns (uint16 longRate, uint16 shortRate) {
        longRate = _congestionRateBps(SIDE_LONG);
        shortRate = _congestionRateBps(SIDE_SHORT);
    }

    function getAccount(address trader)
        external
        view
        returns (uint256 available, uint256 locked, PositionView memory longPos, PositionView memory shortPos)
    {
        available = availableBalance[trader];

        Position memory pLong = positions[trader][SIDE_LONG];
        if (pLong.isOpen) {
            locked += pLong.margin;
        }
        Position memory pShort = positions[trader][SIDE_SHORT];
        if (pShort.isOpen) {
            locked += pShort.margin;
        }

        longPos = this.getPosition(trader, SIDE_LONG);
        shortPos = this.getPosition(trader, SIDE_SHORT);
    }

    function withdrawTreasury(address payable to, uint256 amount) external onlyOwner {
        if (systemBadDebt > 0) revert SystemInsolvent();
        if (to == address(0) || amount == 0) revert InvalidAmount();
        if (queuedTreasuryWithdrawal.queued) revert AdminOperationAlreadyQueued();
        queuedTreasuryWithdrawal = TimelockedWithdrawalOperation({
            to: to,
            amount: amount,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit TreasuryWithdrawalQueued(to, amount, queuedTreasuryWithdrawal.eta);
    }

    function executeTreasuryWithdrawal() external onlyOwner {
        if (!queuedTreasuryWithdrawal.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedTreasuryWithdrawal.eta) revert AdminOperationTimelockPending();
        if (systemBadDebt > 0) revert SystemInsolvent();

        address payable to = queuedTreasuryWithdrawal.to;
        uint256 amount = queuedTreasuryWithdrawal.amount;
        if (amount > treasuryBalance) revert InvalidAmount();

        delete queuedTreasuryWithdrawal;
        treasuryBalance -= amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TreasuryWithdrawn(to, amount);
    }

    function cancelTreasuryWithdrawal() external onlyOwner {
        if (!queuedTreasuryWithdrawal.queued) revert NoAdminOperationQueued();
        address to = queuedTreasuryWithdrawal.to;
        uint256 amount = queuedTreasuryWithdrawal.amount;
        delete queuedTreasuryWithdrawal;
        emit TreasuryWithdrawalCancelled(to, amount);
    }

    function withdrawInsurance(address payable to, uint256 amount) external onlyOwner {
        if (systemBadDebt > 0) revert SystemInsolvent();
        if (to == address(0) || amount == 0) revert InvalidAmount();
        if (queuedInsuranceWithdrawal.queued) revert AdminOperationAlreadyQueued();
        queuedInsuranceWithdrawal = TimelockedWithdrawalOperation({
            to: to,
            amount: amount,
            eta: block.timestamp + adminOpsTimelockSec,
            queued: true
        });
        emit InsuranceWithdrawalQueued(to, amount, queuedInsuranceWithdrawal.eta);
    }

    function executeInsuranceWithdrawal() external onlyOwner {
        if (!queuedInsuranceWithdrawal.queued) revert NoAdminOperationQueued();
        if (block.timestamp < queuedInsuranceWithdrawal.eta) revert AdminOperationTimelockPending();
        if (systemBadDebt > 0) revert SystemInsolvent();

        address payable to = queuedInsuranceWithdrawal.to;
        uint256 amount = queuedInsuranceWithdrawal.amount;
        if (amount > insuranceFund) revert InvalidAmount();

        delete queuedInsuranceWithdrawal;
        insuranceFund -= amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit InsuranceWithdrawn(to, amount);
    }

    function cancelInsuranceWithdrawal() external onlyOwner {
        if (!queuedInsuranceWithdrawal.queued) revert NoAdminOperationQueued();
        address to = queuedInsuranceWithdrawal.to;
        uint256 amount = queuedInsuranceWithdrawal.amount;
        delete queuedInsuranceWithdrawal;
        emit InsuranceWithdrawalCancelled(to, amount);
    }

    function getQueuedKeeperUpdate() external view returns (address value, uint256 eta, bool queued) {
        value = queuedKeeperUpdate.value;
        eta = queuedKeeperUpdate.eta;
        queued = queuedKeeperUpdate.queued;
    }

    function getQueuedOwnershipTransfer() external view returns (address value, uint256 eta, bool queued) {
        value = queuedOwnershipTransfer.value;
        eta = queuedOwnershipTransfer.eta;
        queued = queuedOwnershipTransfer.queued;
    }

    function getQueuedPriceSignerUpdate() external view returns (address value, uint256 eta, bool queued) {
        value = queuedPriceSignerUpdate.value;
        eta = queuedPriceSignerUpdate.eta;
        queued = queuedPriceSignerUpdate.queued;
    }

    function getQueuedDirectSettlementToggle() external view returns (bool value, uint256 eta, bool queued) {
        value = queuedDirectSettlementToggle.value;
        eta = queuedDirectSettlementToggle.eta;
        queued = queuedDirectSettlementToggle.queued;
    }

    function getQueuedPauseDisable() external view returns (bool value, uint256 eta, bool queued) {
        value = queuedPauseDisable.value;
        eta = queuedPauseDisable.eta;
        queued = queuedPauseDisable.queued;
    }

    function getQueuedReduceOnlyDisable() external view returns (bool value, uint256 eta, bool queued) {
        value = queuedReduceOnlyDisable.value;
        eta = queuedReduceOnlyDisable.eta;
        queued = queuedReduceOnlyDisable.queued;
    }

    function getQueuedMaxPriceAgeUpdate() external view returns (uint32 value, uint256 eta, bool queued) {
        value = queuedMaxPriceAgeUpdate.value;
        eta = queuedMaxPriceAgeUpdate.eta;
        queued = queuedMaxPriceAgeUpdate.queued;
    }

    function getQueuedTreasuryWithdrawal()
        external
        view
        returns (address to, uint256 amount, uint256 eta, bool queued)
    {
        to = queuedTreasuryWithdrawal.to;
        amount = queuedTreasuryWithdrawal.amount;
        eta = queuedTreasuryWithdrawal.eta;
        queued = queuedTreasuryWithdrawal.queued;
    }

    function getQueuedInsuranceWithdrawal()
        external
        view
        returns (address to, uint256 amount, uint256 eta, bool queued)
    {
        to = queuedInsuranceWithdrawal.to;
        amount = queuedInsuranceWithdrawal.amount;
        eta = queuedInsuranceWithdrawal.eta;
        queued = queuedInsuranceWithdrawal.queued;
    }

    function _closePosition(address trader, uint8 side) internal {
        if (side > SIDE_SHORT) revert InvalidSide();
        Position memory pos = positions[trader][side];
        if (!pos.isOpen) revert PositionMissing();

        int256 pnl = _positionPnl(pos, side);
        int256 equitySigned = _toInt256(pos.margin) + pnl;

        _removePosition(trader, side, pos);

        uint256 closeFee = 0;
        uint256 payout = 0;

        if (equitySigned > 0) {
            uint256 equity = _toUint256(equitySigned);
            closeFee = (equity * closeFeeBps) / BPS;
            if (closeFee > equity) closeFee = equity;
            payout = equity - closeFee;
            treasuryBalance += closeFee;
            if (payout > 0) {
                availableBalance[trader] += payout;
            }
        } else if (equitySigned < 0) {
            _coverBadDebt(_toAbsUint(equitySigned));
        }

        emit PositionClosed(
            trader,
            side,
            pos.margin,
            pos.weight,
            pos.leverage,
            pnl,
            equitySigned,
            closeFee,
            payout
        );
    }

    function _removePosition(address trader, uint8 side, Position memory pos) internal {
        sideWeight[side] -= pos.weight;
        sideMargin[side] -= pos.margin;
        delete positions[trader][side];
    }

    function _positionPnl(Position memory pos, uint8 side) internal view returns (int256) {
        int256 deltaAcc = accPnlPerWeight[side] - pos.entryAccPnlPerWeight;
        int256 deltaDebt = accDebtPerWeight[side] - pos.entryAccDebtPerWeight;
        return (_toInt256(pos.weight) * (deltaAcc - deltaDebt)) / PRECISION;
    }

    function _validateRiskParams(
        uint32 newMinSettlementInterval,
        uint16 newVolatilityTriggerBps,
        uint16 newSettlementStrengthBps,
        uint16 newMaxSettlementTransferBps,
        uint16 newOpenFeeBps,
        uint16 newCloseFeeBps,
        uint16 newSettlementFeeBps,
        uint16 newCongestionStartBps,
        uint16 newCongestionFullBps,
        uint16 newMaxCongestionFeeBps,
        uint16 newMaintenanceBaseBps,
        uint16 newMaintenanceLeverageBps,
        uint16 newLiquidationPenaltyBps,
        uint16 newLiquidatorRewardShareBps
    ) internal pure {
        if (newMinSettlementInterval == 0 || newMinSettlementInterval > 3600) revert InvalidAmount();
        if (newVolatilityTriggerBps == 0 || newVolatilityTriggerBps > 1000) revert InvalidAmount();
        if (newSettlementStrengthBps == 0 || newSettlementStrengthBps > BPS) revert InvalidAmount();
        if (newMaxSettlementTransferBps == 0 || newMaxSettlementTransferBps > BPS) revert InvalidAmount();
        if (newOpenFeeBps > 500 || newCloseFeeBps > 500) revert InvalidAmount(); // <= 5%
        if (newSettlementFeeBps > 100) revert InvalidAmount(); // <= 1%
        if (newCongestionStartBps >= newCongestionFullBps) revert InvalidAmount();
        if (newMaxCongestionFeeBps > 2000) revert InvalidAmount(); // <= 20%
        if (newMaintenanceBaseBps > 2500) revert InvalidAmount(); // <= 25%
        if (newMaintenanceLeverageBps > 200) revert InvalidAmount(); // <= 2% * lev
        if (newLiquidationPenaltyBps > 3000) revert InvalidAmount(); // <= 30%
        if (newLiquidatorRewardShareBps > BPS) revert InvalidAmount();
    }

    function _applyRiskParams(QueuedRiskParams memory cfg) internal {
        minSettlementInterval = cfg.minSettlementInterval;
        volatilityTriggerBps = cfg.volatilityTriggerBps;
        settlementStrengthBps = cfg.settlementStrengthBps;
        maxSettlementTransferBps = cfg.maxSettlementTransferBps;

        openFeeBps = cfg.openFeeBps;
        closeFeeBps = cfg.closeFeeBps;
        settlementFeeBps = cfg.settlementFeeBps;

        congestionStartBps = cfg.congestionStartBps;
        congestionFullBps = cfg.congestionFullBps;
        maxCongestionFeeBps = cfg.maxCongestionFeeBps;

        maintenanceBaseBps = cfg.maintenanceBaseBps;
        maintenanceLeverageBps = cfg.maintenanceLeverageBps;
        liquidationPenaltyBps = cfg.liquidationPenaltyBps;
        liquidatorRewardShareBps = cfg.liquidatorRewardShareBps;
    }

    function _hashRiskParams(QueuedRiskParams memory cfg) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                cfg.minSettlementInterval,
                cfg.volatilityTriggerBps,
                cfg.settlementStrengthBps,
                cfg.maxSettlementTransferBps,
                cfg.openFeeBps,
                cfg.closeFeeBps,
                cfg.settlementFeeBps,
                cfg.congestionStartBps,
                cfg.congestionFullBps,
                cfg.maxCongestionFeeBps,
                cfg.maintenanceBaseBps,
                cfg.maintenanceLeverageBps,
                cfg.liquidationPenaltyBps,
                cfg.liquidatorRewardShareBps
            )
        );
    }

    function _priceDigest(uint256 newPriceE8, uint64 priceTimestamp, uint64 salt) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), block.chainid, newPriceE8, priceTimestamp, salt));
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (uint256(s) > SECP256K1N_HALF) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();

        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        signer = ecrecover(ethDigest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _maintenanceMargin(Position memory pos) internal view returns (uint256) {
        uint256 mmrBps = uint256(maintenanceBaseBps) + uint256(maintenanceLeverageBps) * pos.leverage;
        return (pos.margin * mmrBps) / BPS;
    }

    function _congestionRateBps(uint8 side) internal view returns (uint16) {
        uint256 current = sideWeight[side];
        uint256 other = sideWeight[_opposite(side)];
        if (current <= other) return 0;

        uint256 total = current + other;
        if (total == 0) return 0;

        uint256 imbalanceBps = ((current - other) * BPS) / total;
        if (imbalanceBps <= congestionStartBps) return 0;
        if (imbalanceBps >= congestionFullBps) return maxCongestionFeeBps;

        uint256 span = congestionFullBps - congestionStartBps;
        return _toUint16((uint256(maxCongestionFeeBps) * (imbalanceBps - congestionStartBps)) / span);
    }

    function _applySideDelta(uint8 side, int256 amount) internal {
        if (amount == 0) return;
        uint256 weight = sideWeight[side];

        if (weight == 0) {
            if (amount > 0) {
                treasuryBalance += _toUint256(amount);
            }
            return;
        }

        int256 perWeight = (amount * PRECISION) / _toInt256(weight);
        accPnlPerWeight[side] += perWeight;
    }

    function _accruePendingSettlementDebt(uint8 debtorSide, uint256 amount) internal {
        if (amount == 0) return;
        uint256 weight = sideWeight[debtorSide];
        if (weight == 0) return;

        int256 perWeightDebt = (_toInt256(amount) * PRECISION) / _toInt256(weight);
        accDebtPerWeight[debtorSide] += perWeightDebt;
        sidePendingSettlementDebt[debtorSide] += amount;
    }

    function _realizePendingDebtForSide(uint8 debtorSide)
        internal
        returns (uint256 grossTransfer, uint256 settlementFee, uint256 winnerNet)
    {
        uint256 debt = sidePendingSettlementDebt[debtorSide];
        if (debt == 0) return (0, 0, 0);

        uint256 capTransfer = (sideMargin[debtorSide] * maxSettlementTransferBps) / BPS;
        grossTransfer = _min(debt, capTransfer);
        if (grossTransfer == 0) return (0, 0, 0);

        uint256 matchedWeight = _min(sideWeight[SIDE_LONG], sideWeight[SIDE_SHORT]);
        uint256 floorByWeight = (matchedWeight * minSettlementFloorBps) / BPS;
        uint256 rawFloor = _max(minSettlementFloorAbsolute, floorByWeight);
        uint256 effectiveFloor = _min(rawFloor, capTransfer);
        if (debt < effectiveFloor) return (0, 0, 0);

        settlementFee = (grossTransfer * settlementFeeBps) / BPS;
        winnerNet = grossTransfer - settlementFee;

        sidePendingSettlementDebt[debtorSide] = debt - grossTransfer;
        _applySideDelta(_opposite(debtorSide), _toInt256(winnerNet));
        treasuryBalance += settlementFee;
    }

    function _coverBadDebt(uint256 debt) internal {
        if (debt == 0) return;
        if (insuranceFund >= debt) {
            insuranceFund -= debt;
            return;
        }

        uint256 remaining = debt - insuranceFund;
        insuranceFund = 0;

        if (treasuryBalance >= remaining) {
            treasuryBalance -= remaining;
            return;
        }
        uint256 uncovered = remaining - treasuryBalance;
        treasuryBalance = 0;
        systemBadDebt += uncovered;
        emit BadDebtRecorded(uncovered, systemBadDebt);
    }

    function _creditInsurance(uint256 amount) internal {
        if (amount == 0) return;
        if (systemBadDebt > 0) {
            uint256 toDebt = _min(amount, systemBadDebt);
            systemBadDebt -= toDebt;
            amount -= toDebt;
        }
        if (amount > 0) {
            insuranceFund += amount;
        }
    }

    function _deposit(address trader, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        availableBalance[trader] += amount;
        emit Deposited(trader, amount, availableBalance[trader]);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a <= b ? a : b;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

    function _opposite(uint8 side) internal pure returns (uint8) {
        return side == SIDE_LONG ? SIDE_SHORT : SIDE_LONG;
    }

    function _toInt256(uint256 value) internal pure returns (int256) {
        if (value > uint256(type(int256).max)) revert InvalidAmount();
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(value);
    }

    function _toUint256(int256 value) internal pure returns (uint256) {
        if (value < 0) revert InvalidAmount();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(value);
    }

    function _toAbsUint(int256 value) internal pure returns (uint256) {
        if (value >= 0) revert InvalidAmount();
        if (value == type(int256).min) revert InvalidAmount();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(-value);
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) revert PriceOutOfRange();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(value);
    }

    function _toUint16(uint256 value) internal pure returns (uint16) {
        if (value > type(uint16).max) revert InvalidAmount();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(value);
    }
}

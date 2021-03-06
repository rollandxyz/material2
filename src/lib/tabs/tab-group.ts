/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {coerceBooleanProperty, coerceNumberProperty} from '@angular/cdk/coercion';
import {
  AfterContentChecked,
  AfterContentInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ContentChildren,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import {
  CanColor,
  CanDisableRipple,
  mixinColor,
  mixinDisableRipple,
  ThemePalette
} from '@angular/material/core';
import {merge, Subscription} from 'rxjs';
import {MatTab} from './tab';
import {MatTabHeader} from './tab-header';


/** Used to generate unique ID's for each tab component */
let nextId = 0;

/** A simple change event emitted on focus or selection changes. */
export class MatTabChangeEvent {
  /** Index of the currently-selected tab. */
  index: number;
  /** Reference to the currently-selected tab. */
  tab: MatTab;
}

/** Possible positions for the tab header. */
export type MatTabHeaderPosition = 'above' | 'below';

// Boilerplate for applying mixins to MatTabGroup.
/** @docs-private */
export class MatTabGroupBase {
  constructor(public _elementRef: ElementRef) {}
}
export const _MatTabGroupMixinBase = mixinColor(mixinDisableRipple(MatTabGroupBase), 'primary');

/**
 * Material design tab-group component.  Supports basic tab pairs (label + content) and includes
 * animated ink-bar, keyboard navigation, and screen reader.
 * See: https://material.io/design/components/tabs.html
 */
@Component({
  moduleId: module.id,
  selector: 'mat-tab-group',
  exportAs: 'matTabGroup',
  templateUrl: 'tab-group.html',
  styleUrls: ['tab-group.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  inputs: ['color', 'disableRipple'],
  host: {
    'class': 'mat-tab-group',
    '[class.mat-tab-group-dynamic-height]': 'dynamicHeight',
    '[class.mat-tab-group-inverted-header]': 'headerPosition === "below"',
  },
})
export class MatTabGroup extends _MatTabGroupMixinBase implements AfterContentInit,
    AfterContentChecked, OnDestroy, CanColor, CanDisableRipple {

  @ContentChildren(MatTab) _tabs: QueryList<MatTab>;

  @ViewChild('tabBodyWrapper') _tabBodyWrapper: ElementRef;

  @ViewChild('tabHeader') _tabHeader: MatTabHeader;

  /** The tab index that should be selected after the content has been checked. */
  private _indexToSelect: number | null = 0;

  /** Snapshot of the height of the tab body wrapper before another tab is activated. */
  private _tabBodyWrapperHeight: number = 0;

  /** Subscription to tabs being added/removed. */
  private _tabsSubscription = Subscription.EMPTY;

  /** Subscription to changes in the tab labels. */
  private _tabLabelSubscription = Subscription.EMPTY;

  /** Whether the tab group should grow to the size of the active tab. */
  @Input()
  get dynamicHeight(): boolean { return this._dynamicHeight; }
  set dynamicHeight(value: boolean) { this._dynamicHeight = coerceBooleanProperty(value); }
  private _dynamicHeight: boolean = false;

  /** The index of the active tab. */
  @Input()
  get selectedIndex(): number | null { return this._selectedIndex; }
  set selectedIndex(value: number | null) {
    this._indexToSelect = coerceNumberProperty(value, null);
  }
  private _selectedIndex: number | null = null;

  /** Position of the tab header. */
  @Input() headerPosition: MatTabHeaderPosition = 'above';

  /** Background color of the tab group. */
  @Input()
  get backgroundColor(): ThemePalette { return this._backgroundColor; }
  set backgroundColor(value: ThemePalette) {
    const nativeElement: HTMLElement = this._elementRef.nativeElement;

    nativeElement.classList.remove(`mat-background-${this.backgroundColor}`);

    if (value) {
      nativeElement.classList.add(`mat-background-${value}`);
    }

    this._backgroundColor = value;
  }
  private _backgroundColor: ThemePalette;

  /** Output to enable support for two-way binding on `[(selectedIndex)]` */
  @Output() readonly selectedIndexChange: EventEmitter<number> = new EventEmitter<number>();

  /** Event emitted when focus has changed within a tab group. */
  @Output() readonly focusChange: EventEmitter<MatTabChangeEvent> =
      new EventEmitter<MatTabChangeEvent>();

  /** Event emitted when the body animation has completed */
  @Output() readonly animationDone: EventEmitter<void> = new EventEmitter<void>();

  /** Event emitted when the tab selection has changed. */
  @Output() readonly selectedTabChange: EventEmitter<MatTabChangeEvent> =
      new EventEmitter<MatTabChangeEvent>(true);

  private _groupId: number;

  constructor(elementRef: ElementRef,
              private _changeDetectorRef: ChangeDetectorRef) {
    super(elementRef);
    this._groupId = nextId++;
  }

  /**
   * After the content is checked, this component knows what tabs have been defined
   * and what the selected index should be. This is where we can know exactly what position
   * each tab should be in according to the new selected index, and additionally we know how
   * a new selected tab should transition in (from the left or right).
   */
  ngAfterContentChecked() {
    // Clamp the next selected index to the boundsof 0 and the tabs length.
    // Note the `|| 0`, which ensures that values like NaN can't get through
    // and which would otherwise throw the component into an infinite loop
    // (since Math.max(NaN, 0) === NaN).
    let indexToSelect = this._indexToSelect =
        Math.min(this._tabs.length - 1, Math.max(this._indexToSelect || 0, 0));

    // If there is a change in selected index, emit a change event. Should not trigger if
    // the selected index has not yet been initialized.
    if (this._selectedIndex != indexToSelect && this._selectedIndex != null) {
      const tabChangeEvent = this._createChangeEvent(indexToSelect);
      this.selectedTabChange.emit(tabChangeEvent);
      // Emitting this value after change detection has run
      // since the checked content may contain this variable'
      Promise.resolve().then(() => this.selectedIndexChange.emit(indexToSelect));
    }

    // Setup the position for each tab and optionally setup an origin on the next selected tab.
    this._tabs.forEach((tab: MatTab, index: number) => {
      tab.position = index - indexToSelect;
      tab.isActive = index === indexToSelect;

      // If there is already a selected tab, then set up an origin for the next selected tab
      // if it doesn't have one already.
      if (this._selectedIndex != null && tab.position == 0 && !tab.origin) {
        tab.origin = indexToSelect - this._selectedIndex;
      }
    });

    if (this._selectedIndex !== indexToSelect) {
      this._selectedIndex = indexToSelect;
      this._changeDetectorRef.markForCheck();
    }
  }

  ngAfterContentInit() {
    this._subscribeToTabLabels();

    // Subscribe to changes in the amount of tabs, in order to be
    // able to re-render the content as new tabs are added or removed.
    this._tabsSubscription = this._tabs.changes.subscribe(() => {
      this._subscribeToTabLabels();
      this._changeDetectorRef.markForCheck();
    });
  }

  ngOnDestroy() {
    this._tabsSubscription.unsubscribe();
    this._tabLabelSubscription.unsubscribe();
  }

  /** Re-aligns the ink bar to the selected tab element. */
  realignInkBar() {
    if (this._tabHeader) {
      this._tabHeader._alignInkBarToSelectedTab();
    }
  }

  _focusChanged(index: number) {
    this.focusChange.emit(this._createChangeEvent(index));
  }

  private _createChangeEvent(index: number): MatTabChangeEvent {
    const event = new MatTabChangeEvent;
    event.index = index;
    if (this._tabs && this._tabs.length) {
      event.tab = this._tabs.toArray()[index];
    }
    return event;
  }

  /**
   * Subscribes to changes in the tab labels. This is needed, because the @Input for the label is
   * on the MatTab component, whereas the data binding is inside the MatTabGroup. In order for the
   * binding to be updated, we need to subscribe to changes in it and trigger change detection
   * manually.
   */
  private _subscribeToTabLabels() {
    if (this._tabLabelSubscription) {
      this._tabLabelSubscription.unsubscribe();
    }

    this._tabLabelSubscription = merge(
        ...this._tabs.map(tab => tab._disableChange),
        ...this._tabs.map(tab => tab._labelChange)).subscribe(() => {
      this._changeDetectorRef.markForCheck();
    });
  }

  /** Returns a unique id for each tab label element */
  _getTabLabelId(i: number): string {
    return `mat-tab-label-${this._groupId}-${i}`;
  }

  /** Returns a unique id for each tab content element */
  _getTabContentId(i: number): string {
    return `mat-tab-content-${this._groupId}-${i}`;
  }

  /**
   * Sets the height of the body wrapper to the height of the activating tab if dynamic
   * height property is true.
   */
  _setTabBodyWrapperHeight(tabHeight: number): void {
    if (!this._dynamicHeight || !this._tabBodyWrapperHeight) { return; }

    const wrapper: HTMLElement = this._tabBodyWrapper.nativeElement;

    wrapper.style.height = this._tabBodyWrapperHeight + 'px';

    // This conditional forces the browser to paint the height so that
    // the animation to the new height can have an origin.
    if (this._tabBodyWrapper.nativeElement.offsetHeight) {
      wrapper.style.height = tabHeight + 'px';
    }
  }

  /** Removes the height of the tab body wrapper. */
  _removeTabBodyWrapperHeight(): void {
    this._tabBodyWrapperHeight = this._tabBodyWrapper.nativeElement.clientHeight;
    this._tabBodyWrapper.nativeElement.style.height = '';
    this.animationDone.emit();
  }

  /** Handle click events, setting new selected index if appropriate. */
  _handleClick(tab: MatTab, tabHeader: MatTabHeader, idx: number) {
    if (!tab.disabled) {
      this.selectedIndex = tabHeader.focusIndex = idx;
    }
  }

  /** Retrieves the tabindex for the tab. */
  _getTabIndex(tab: MatTab, idx: number): number | null {
    if (tab.disabled) {
      return null;
    }
    return this.selectedIndex === idx ? 0 : -1;
  }
}
